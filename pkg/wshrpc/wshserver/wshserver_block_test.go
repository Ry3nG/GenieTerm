// Copyright 2026, GenieTerm. Apache-2.0.

//go:build cgo

package wshserver

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wcore"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wstore"
	"github.com/google/uuid"
)

func TestDeleteBlockPreservesSurvivingLayoutAndClosesLastTab(t *testing.T) {
	const homeEnv = "GENIETERM_TEST_BLOCKDELETE_HOME"
	home := os.Getenv(homeEnv)
	if home == "" {
		// The store owns a process-global SQLite handle; isolate it so Windows can
		// remove the temporary database after the child has closed all handles.
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDeleteBlockPreservesSurvivingLayoutAndClosesLastTab$", "-test.v")
		cmd.Env = append(os.Environ(), homeEnv+"="+t.TempDir())
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("real SQLite block deletion: %v\n%s", err, out)
		}
		return
	}
	wavebase.DataHome_VarCache = home
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		t.Fatal(err)
	}
	if err := wstore.InitWStore(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	client := &waveobj.Client{OID: uuid.NewString()}
	if err := wstore.DBInsert(ctx, client); err != nil {
		t.Fatal(err)
	}
	for _, count := range []int{2, 1} {
		workspace := &waveobj.Workspace{OID: uuid.NewString()}
		window := &waveobj.Window{OID: uuid.NewString(), WorkspaceId: workspace.OID}
		layout := &waveobj.LayoutState{OID: uuid.NewString()}
		tab := &waveobj.Tab{OID: uuid.NewString(), LayoutState: layout.OID}
		workspace.TabIds, workspace.ActiveTabId = []string{tab.OID}, tab.OID
		for i := 0; i < count; i++ {
			block := &waveobj.Block{OID: uuid.NewString(), ParentORef: "tab:" + tab.OID, Meta: waveobj.MetaMapType{"view": "preview"}}
			tab.BlockIds = append(tab.BlockIds, block.OID)
			if err := wstore.DBInsert(ctx, block); err != nil {
				t.Fatal(err)
			}
		}
		for _, obj := range []waveobj.WaveObj{workspace, window, layout, tab} {
			if err := wstore.DBInsert(ctx, obj); err != nil {
				t.Fatal(err)
			}
		}
		client.WindowIds = append(client.WindowIds, window.OID)
		if err := wstore.DBUpdate(ctx, client); err != nil {
			t.Fatal(err)
		}
		deletedId := tab.BlockIds[0]
		if err := WshServerImpl.DeleteBlockCommand(ctx, wshrpc.CommandDeleteBlockData{BlockId: deletedId}); err != nil {
			t.Fatal(err)
		}
		if block, err := wstore.DBGet[*waveobj.Block](ctx, deletedId); err != nil || block != nil {
			t.Fatalf("deleted block remains: %#v, %v", block, err)
		}
		remainingTab, err := wstore.DBGet[*waveobj.Tab](ctx, tab.OID)
		if err != nil {
			t.Fatal(err)
		}
		remainingLayout, err := wstore.DBGet[*waveobj.LayoutState](ctx, layout.OID)
		if err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			if remainingTab != nil || remainingLayout != nil {
				t.Fatal("last block retained its tab or layout")
			}
			if _, err := wcore.GetLayoutIdForTab(ctx, tab.OID); !errors.Is(err, wstore.ErrNotFound) {
				t.Fatalf("missing tab layout error = %v", err)
			}
			if err := wcore.QueueLayoutAction(ctx, layout.OID, waveobj.LayoutActionData{}); !errors.Is(err, wstore.ErrNotFound) {
				t.Fatalf("missing layout action error = %v", err)
			}
			if remainingWindow, err := wstore.DBGet[*waveobj.Window](ctx, window.OID); err != nil || remainingWindow != nil {
				t.Fatalf("last tab retained window: %#v, %v", remainingWindow, err)
			}
			continue
		}
		if remainingTab == nil || len(remainingTab.BlockIds) != 1 || remainingTab.BlockIds[0] != tab.BlockIds[1] {
			t.Fatalf("surviving block lost: %#v", remainingTab)
		}
		if remainingLayout == nil || remainingLayout.PendingBackendActions == nil || len(*remainingLayout.PendingBackendActions) != 1 {
			t.Fatalf("missing removal action: %#v", remainingLayout)
		}
		action := (*remainingLayout.PendingBackendActions)[0]
		if action.ActionType != wcore.LayoutActionDataType_Remove || action.BlockId != deletedId {
			t.Fatalf("wrong removal action: %#v", action)
		}
	}
}
