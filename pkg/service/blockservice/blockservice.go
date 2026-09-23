// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/blockcontroller"
	"github.com/Ry3nG/GenieTerm/pkg/filestore"
	"github.com/Ry3nG/GenieTerm/pkg/tsgen/tsgenmeta"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wcore"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wstore"
	"github.com/google/uuid"
)

type BlockService struct{}

const DefaultTimeout = 2 * time.Second

var BlockServiceInstance = &BlockService{}

func (bs *BlockService) SendCommand_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "send command to block",
		ArgNames: []string{"blockid", "cmd"},
	}
}

func (bs *BlockService) GetControllerStatus(ctx context.Context, blockId string) (*blockcontroller.BlockControllerRuntimeStatus, error) {
	return blockcontroller.GetBlockControllerRuntimeStatus(blockId), nil
}

func (*BlockService) SaveTerminalState_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "save the terminal state to a blockfile",
		ArgNames: []string{"ctx", "blockId", "state", "stateType", "ptyOffset", "termSize", "commandIndex", "stateHash", "fileEpoch", "revision"},
	}
}

func (bs *BlockService) SaveTerminalState(ctx context.Context, blockId string, state string, stateType string, ptyOffset int64, termSize waveobj.TermSize, commandIndex string, stateHash string, fileEpoch int64, revision int64) error {
	_, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	if stateType != "full" && stateType != "preview" {
		return fmt.Errorf("invalid state type: %q", stateType)
	}
	lock := filestore.TerminalStateLock(blockId)
	lock.Lock()
	defer lock.Unlock()
	termFile, err := filestore.WFS.Stat(ctx, blockId, "term")
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("cannot read terminal output before caching: %w", err)
	}
	if termFile.Size < ptyOffset {
		return nil
	}
	if filestore.TerminalFileEpoch(termFile.Meta) != fileEpoch {
		return nil
	}
	cacheName := "cache:term:" + stateType
	// ignore MakeFile error (already exists is ok)
	filestore.WFS.MakeFile(ctx, blockId, cacheName, nil, wshrpc.FileOpts{})
	cacheFile, err := filestore.WFS.Stat(ctx, blockId, cacheName)
	if err != nil {
		return fmt.Errorf("cannot read terminal cache metadata: %w", err)
	}
	if filestore.TerminalFileEpoch(cacheFile.Meta) == fileEpoch {
		cachedPtyOffset := cachedOffset(cacheFile.Meta)
		if cachedPtyOffset > ptyOffset || (cachedPtyOffset == ptyOffset && cachedRevision(cacheFile.Meta) >= revision) {
			return nil
		}
	}
	err = filestore.WFS.WriteFile(ctx, blockId, cacheName, []byte(state))
	if err != nil {
		return fmt.Errorf("cannot save terminal state: %w", err)
	}
	fileMeta := wshrpc.FileMeta{
		"ptyoffset":    ptyOffset,
		"termsize":     termSize,
		"commandindex": commandIndex,
		"statehash":    stateHash,
		"fileepoch":    fileEpoch,
		"revision":     revision,
	}
	err = filestore.WFS.WriteMeta(ctx, blockId, cacheName, fileMeta, true)
	if err != nil {
		return fmt.Errorf("cannot save terminal state meta: %w", err)
	}
	return nil
}

func cachedOffset(meta wshrpc.FileMeta) int64 {
	switch offset := meta["ptyoffset"].(type) {
	case int:
		return int64(offset)
	case int64:
		return offset
	case float64:
		return int64(offset)
	default:
		return -1
	}
}

func cachedRevision(meta wshrpc.FileMeta) int64 {
	switch revision := meta["revision"].(type) {
	case int:
		return int64(revision)
	case int64:
		return revision
	case float64:
		return int64(revision)
	default:
		return -1
	}
}

func (*BlockService) CleanupOrphanedBlocks_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "queue a layout action to cleanup orphaned blocks in the tab",
		ArgNames: []string{"ctx", "tabId"},
	}
}

func (bs *BlockService) CleanupOrphanedBlocks(ctx context.Context, tabId string) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	layoutAction := waveobj.LayoutActionData{
		ActionType: wcore.LayoutActionDataType_CleanupOrphaned,
		ActionId:   uuid.NewString(),
	}
	err := wcore.QueueLayoutActionForTab(ctx, tabId, layoutAction)
	if err != nil {
		return nil, fmt.Errorf("error queuing cleanup layout action: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}
