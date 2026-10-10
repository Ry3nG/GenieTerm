// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestSysInfoWatcherExpires(t *testing.T) {
	sysInfoWatchLock.Lock()
	sysInfoWatchers = make(map[string]time.Time)
	sysInfoWatchLock.Unlock()

	SetSysInfoWatchActive("a", true)
	SetSysInfoWatchActive("b", true)
	if !sysInfoHasWatchers() {
		t.Fatalf("expected watchers")
	}
	SetSysInfoWatchActive("a", false)
	sysInfoWatchLock.Lock()
	sysInfoWatchers["b"] = time.Now().Add(-SysInfoWatchExpiry)
	sysInfoWatchLock.Unlock()
	if sysInfoHasWatchers() {
		t.Fatalf("expected stale watcher to expire")
	}
}

func TestProcCacheKeepAliveDoesNotRenewLease(t *testing.T) {
	s := &procCacheState{}
	s.storeWidgetPidOrder("w1", []int32{1, 2}, 2)
	s.leases = map[string]*procLease{
		"w1": {lastSeen: time.Now().Add(-ProcCacheIdleTimeout), interval: 2 * time.Second},
	}
	s.touchWidgetPidOrder("w1")

	firstDone := true
	exit, _ := s.updateCacheAndCheckIdle(&wshrpc.ProcessListResponse{HasCPU: true}, &firstDone, nil)
	if !exit {
		t.Fatalf("expected loop to exit once the only lease expired")
	}
	if pids, _ := s.getWidgetPidOrder("w1"); len(pids) != 2 {
		t.Fatalf("expected pid order to survive loop idle, got %v", pids)
	}
}

func TestProcCacheSleepsSmallestInterval(t *testing.T) {
	s := &procCacheState{}
	s.leases = map[string]*procLease{
		"w1": {lastSeen: time.Now(), interval: 5 * time.Second},
		"w2": {lastSeen: time.Now(), interval: 2 * time.Second},
	}
	firstDone := true
	exit, interval := s.updateCacheAndCheckIdle(&wshrpc.ProcessListResponse{HasCPU: true}, &firstDone, nil)
	if exit || interval != 2*time.Second {
		t.Fatalf("expected 2s interval, got exit=%v interval=%v", exit, interval)
	}
	s.releaseWidget("w2")
	_, interval = s.updateCacheAndCheckIdle(nil, &firstDone, nil)
	if interval != 5*time.Second {
		t.Fatalf("expected 5s interval after release, got %v", interval)
	}
}

func TestClampProcInterval(t *testing.T) {
	if clampProcInterval(0) != ProcCacheDefaultInterval {
		t.Fatalf("expected default interval")
	}
	if clampProcInterval(60000) != ProcCacheMaxInterval {
		t.Fatalf("expected max interval")
	}
	if clampProcInterval(2000) != 2*time.Second {
		t.Fatalf("expected 2s interval")
	}
}
