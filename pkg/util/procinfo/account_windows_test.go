// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import (
	"context"
	"os"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsUserLookupUnavailable(t *testing.T) {
	if name := windowsProcessUser(context.Background(), 0); name != "" {
		t.Fatalf("inaccessible process must not invent a user: %q", name)
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(os.Getpid()))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	if name := windowsProcessUser(context.Background(), handle); name != "" {
		t.Fatalf("process handle without query rights returned %q", name)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if name := windowsProcessUser(ctx, windows.CurrentProcess()); name != "" {
		t.Fatalf("canceled user lookup returned %q", name)
	}
}

func TestWindowsUserCacheBoundsAndExpiry(t *testing.T) {
	var calls atomic.Int32
	cache := &windowsUserCache{resolve: func(key string) string {
		calls.Add(1)
		return "account-" + key
	}}
	for i := 0; i < windowsUserCacheLimit+5; i++ {
		key := strconv.Itoa(i)
		if got := cache.lookup(context.Background(), key); got != "account-"+key {
			t.Fatalf("lookup %s = %q", key, got)
		}
	}
	if len(cache.entries) > windowsUserCacheLimit {
		t.Fatalf("unbounded cache: %d entries", len(cache.entries))
	}
	lastKey := strconv.Itoa(windowsUserCacheLimit + 4)
	before := calls.Load()
	if got := cache.lookup(context.Background(), lastKey); got != "account-"+lastKey || calls.Load() != before {
		t.Fatal("cached account was looked up again")
	}
	cache.entries[lastKey].expires = time.Now().Add(-time.Second)
	cache.lookup(context.Background(), lastKey)
	if calls.Load() != before+1 {
		t.Fatal("expired account was not refreshed")
	}
}

func TestWindowsUserCacheCancellationAndWorkerBound(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	var calls atomic.Int32
	cache := &windowsUserCache{resolve: func(key string) string {
		calls.Add(1)
		<-release
		return key
	}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := cache.lookup(ctx, "canceled"); got != "" || calls.Load() != 0 {
		t.Fatal("canceled lookup started native work")
	}
	for i := 0; i < windowsUserLookupLimit; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		if got := cache.lookup(ctx, strconv.Itoa(i)); got != "" {
			t.Errorf("blocked lookup returned %q", got)
		}
		cancel()
	}
	if got := cache.lookup(context.Background(), "overflow"); got != "" {
		t.Errorf("worker overflow returned %q", got)
	}
	if calls.Load() != windowsUserLookupLimit {
		t.Fatalf("native lookups = %d, want limit %d", calls.Load(), windowsUserLookupLimit)
	}
	if len(cache.entries) != windowsUserLookupLimit {
		t.Fatalf("unexpected entries for saturated workers: %d", len(cache.entries))
	}
	if got := cache.lookup(context.Background(), "0"); got != "" {
		t.Errorf("pending shared SID lookup returned %q", got)
	}
}
