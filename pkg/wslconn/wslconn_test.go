// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wslconn

import (
	"sync"
	"sync/atomic"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wsl"
)

func TestWaitForDisconnectMarksDisconnectedAndClearsWaiter(t *testing.T) {
	client := &wsl.Distro{}
	conn := &WslConn{
		Lock:       &sync.Mutex{},
		Status:     Status_Connected,
		Name:       wsl.WslName{Distro: "test"},
		Client:     client,
		WshEnabled: &atomic.Bool{},
		HasWaiter:  &atomic.Bool{},
		cancelFn:   func() {},
	}
	controller := &wsl.WslCmd{}
	conn.ConnController = controller
	conn.HasWaiter.Store(true)
	// an unstarted exec.Cmd returns from Wait immediately, standing in for a connserver exit
	conn.waitForDisconnect(client, controller)
	if conn.HasWaiter.Load() {
		t.Fatalf("waiter flag not cleared")
	}
	if conn.GetStatus() != Status_Disconnected || conn.GetClient() != nil {
		t.Fatalf("expected disconnected status, got %s", conn.GetStatus())
	}
}

func TestWaitForDisconnectIgnoresClosedConn(t *testing.T) {
	conn := &WslConn{
		Lock:       &sync.Mutex{},
		Status:     Status_Disconnected,
		Name:       wsl.WslName{Distro: "test"},
		WshEnabled: &atomic.Bool{},
		HasWaiter:  &atomic.Bool{},
	}
	conn.HasWaiter.Store(true)
	conn.waitForDisconnect(&wsl.Distro{}, &wsl.WslCmd{})
	if conn.HasWaiter.Load() {
		t.Fatalf("waiter flag not cleared")
	}
	if conn.Error != "" {
		t.Fatalf("closed conn should not record an error: %q", conn.Error)
	}
}
