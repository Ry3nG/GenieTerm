// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"context"
	"fmt"
)

var waveObjUpdateKey = struct{}{}

type contextUpdatesType struct {
	UpdatesStack []map[ORef]WaveObjUpdate
}

func ContextWithUpdates(ctx context.Context) context.Context {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal != nil {
		return ctx
	}
	return context.WithValue(ctx, waveObjUpdateKey, &contextUpdatesType{
		UpdatesStack: []map[ORef]WaveObjUpdate{make(map[ORef]WaveObjUpdate)},
	})
}

func ContextGetUpdates(ctx context.Context) map[ORef]WaveObjUpdate {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return nil
	}
	updates := updatesVal.(*contextUpdatesType)
	if len(updates.UpdatesStack) == 1 {
		return updates.UpdatesStack[0]
	}
	rtn := make(map[ORef]WaveObjUpdate)
	for _, update := range updates.UpdatesStack {
		for k, v := range update {
			rtn[k] = v
		}
	}
	return rtn
}

func ContextAddUpdate(ctx context.Context, update WaveObjUpdate) {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return
	}
	updates := updatesVal.(*contextUpdatesType)
	oref := ORef{
		OType: update.OType,
		OID:   update.OID,
	}
	updates.UpdatesStack[len(updates.UpdatesStack)-1][oref] = update
}

func ContextUpdatesBeginTx(ctx context.Context) context.Context {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return ctx
	}
	updates := updatesVal.(*contextUpdatesType)
	updates.UpdatesStack = append(updates.UpdatesStack, make(map[ORef]WaveObjUpdate))
	return ctx
}

func ContextUpdatesCommitTx(ctx context.Context) {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return
	}
	updates := updatesVal.(*contextUpdatesType)
	if len(updates.UpdatesStack) <= 1 {
		panic(fmt.Errorf("no updates transaction to commit"))
	}
	// merge the last two updates
	curUpdateMap := updates.UpdatesStack[len(updates.UpdatesStack)-1]
	prevUpdateMap := updates.UpdatesStack[len(updates.UpdatesStack)-2]
	for k, v := range curUpdateMap {
		prevUpdateMap[k] = v
	}
	updates.UpdatesStack = updates.UpdatesStack[:len(updates.UpdatesStack)-1]
}

func ContextUpdatesRollbackTx(ctx context.Context) {
	updatesVal := ctx.Value(waveObjUpdateKey)
	if updatesVal == nil {
		return
	}
	updates := updatesVal.(*contextUpdatesType)
	if len(updates.UpdatesStack) <= 1 {
		panic(fmt.Errorf("no updates transaction to rollback"))
	}
	updates.UpdatesStack = updates.UpdatesStack[:len(updates.UpdatesStack)-1]
}

func ContextGetUpdatesRtn(ctx context.Context) UpdatesRtnType {
	updatesMap := ContextGetUpdates(ctx)
	if updatesMap == nil {
		return nil
	}
	rtn := make(UpdatesRtnType, 0, len(updatesMap))
	for _, v := range updatesMap {
		rtn = append(rtn, v)
	}
	return rtn
}
