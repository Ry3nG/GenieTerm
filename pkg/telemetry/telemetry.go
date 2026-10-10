// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package telemetry is a no-op in GenieTerm: nothing is uploaded and nothing is recorded locally.
// The record APIs are kept (instead of deleting the ~40 inherited call sites) so the soft fork
// stays easy to merge with upstream Wave.
package telemetry

import (
	"context"

	"github.com/Ry3nG/GenieTerm/pkg/telemetry/telemetrydata"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wstore"
)

const ActivityEventName = "app:activity"
const WshRunEventName = "wsh:run"

func GoUpdateActivityWrap(update wshrpc.ActivityUpdate, debugStr string) {}

func GoRecordTEventWrap(tevent *telemetrydata.TEvent) {}

func RecordTEvent(ctx context.Context, tevent *telemetrydata.TEvent) error {
	return nil
}

func UpdateActivity(ctx context.Context, update wshrpc.ActivityUpdate) error {
	return nil
}

// PurgeLocalTelemetry deletes rows recorded by earlier versions. The tables themselves are kept
// so existing databases and migrations stay valid.
func PurgeLocalTelemetry(ctx context.Context) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		tx.Exec(`DELETE FROM db_tevent`)
		tx.Exec(`DELETE FROM db_activity`)
		return nil
	})
}
