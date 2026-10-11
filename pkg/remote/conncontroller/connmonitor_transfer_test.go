// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"testing"
	"time"
)

func TestMonitorTreatsAMovingUploadAsHealthy(t *testing.T) {
	cm := &ConnMonitor{}
	now := time.Now().UnixMilli()
	if cm.isTransferring(now, 10000) {
		t.Fatal("no upload has happened yet")
	}
	cm.LastTransferTime.Store(now - 2000)
	if !cm.isTransferring(now, 10000) {
		t.Fatal("bytes accepted 2s ago means the link is moving")
	}
	cm.LastTransferTime.Store(now - 30000)
	if cm.isTransferring(now, 10000) {
		t.Fatal("an upload that stopped 30s ago no longer vouches for the link")
	}
}
