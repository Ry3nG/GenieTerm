// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
)

func TestIsWshVersionUpToDateRequiresGeniePrimaryHelper(t *testing.T) {
	oldVersion := wavebase.WaveVersion
	t.Cleanup(func() {
		wavebase.WaveVersion = oldVersion
	})
	wavebase.WaveVersion = "0.4.0"

	ok, version, osArch, err := IsWshVersionUpToDate(context.Background(), "genie v0.4.0")
	if err != nil {
		t.Fatalf("genie version check returned error: %v", err)
	}
	if !ok || version != "v0.4.0" || osArch != "" {
		t.Fatalf("genie current version returned ok=%v version=%q osArch=%q", ok, version, osArch)
	}

	ok, version, osArch, err = IsWshVersionUpToDate(context.Background(), "wsh v0.4.0")
	if err != nil {
		t.Fatalf("wsh fallback version check returned error: %v", err)
	}
	if ok || version != "v0.4.0" || osArch != "" {
		t.Fatalf("wsh fallback should require genie install, got ok=%v version=%q osArch=%q", ok, version, osArch)
	}
}

func TestMakeConnServerCommandPrefersGenieWithWshFallback(t *testing.T) {
	cmd := MakeConnServerCommand(
		wavebase.RemoteFullGenieBinPath,
		wavebase.RemoteFullWshBinPath,
		"prod-east",
		"--dev",
		"--router-domainsocket",
	)

	if !strings.Contains(cmd, wavebase.RemoteFullGenieBinPath) {
		t.Fatalf("command does not contain genie primary path: %s", cmd)
	}
	if !strings.Contains(cmd, wavebase.RemoteFullWshBinPath) {
		t.Fatalf("command does not contain wsh fallback path: %s", cmd)
	}
	if strings.Index(cmd, wavebase.RemoteFullGenieBinPath) > strings.Index(cmd, wavebase.RemoteFullWshBinPath) {
		t.Fatalf("command should prefer genie before wsh fallback: %s", cmd)
	}
	if !strings.Contains(cmd, "connserver --conn prod-east --dev --router-domainsocket") {
		t.Fatalf("command does not preserve connserver arguments: %s", cmd)
	}
}

// blockingListener simulates a handle whose Close() hangs on a dead network
// transport (as DomainSockListener.Close() can when it tries to send SSH
// packets over a reset connection).
type blockingListener struct {
	closeStarted chan struct{}
	release      chan struct{}
}

func (l *blockingListener) Accept() (net.Conn, error) { return nil, errors.New("not implemented") }
func (l *blockingListener) Addr() net.Addr            { return nil }
func (l *blockingListener) Close() error {
	close(l.closeStarted)
	<-l.release
	return nil
}

// A dropped SSH connection used to wedge the conn forever: closeInternal ran
// while holding lifecycleLock, and a handle Close() that blocked on the dead
// transport meant Status never went to Disconnected and every later
// connect/disconnect deadlocked. closeInternal must now return promptly and let
// the slow close happen in the background.
func TestCloseInternalDoesNotBlockOnDeadHandle(t *testing.T) {
	opts, err := remote.ParseOpts("zrgong@paw-5090-ws")
	if err != nil {
		t.Fatalf("ParseOpts failed: %v", err)
	}
	listener := &blockingListener{
		closeStarted: make(chan struct{}),
		release:      make(chan struct{}),
	}
	defer close(listener.release)

	conn := &SSHConn{
		lock:               &sync.Mutex{},
		lifecycleLock:      &sync.Mutex{},
		Status:             Status_Connected,
		ConnHealthStatus:   ConnHealthStatus_Good,
		WshEnabled:         &atomic.Bool{},
		Opts:               opts,
		DomainSockListener: listener,
	}

	returned := make(chan struct{})
	go func() {
		conn.closeInternal_withlifecyclelock()
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("closeInternal_withlifecyclelock blocked on a dead handle close")
	}

	select {
	case <-listener.closeStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("background close never ran the handle Close()")
	}

	conn.lock.Lock()
	detached := conn.DomainSockListener == nil
	conn.lock.Unlock()
	if !detached {
		t.Fatal("expected DomainSockListener to be detached (nil) so a reconnect starts fresh")
	}
}
