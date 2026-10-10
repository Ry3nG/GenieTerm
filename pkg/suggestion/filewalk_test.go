// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package suggestion

import (
	"testing"
	"time"
)

func isCacheCleanerRunning() bool {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	return cacheCleanerRunning
}

func expireCacheEntry(key string) {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	cache[key].expiration = time.Now().Add(-time.Second)
}

func TestCacheCleanerStopsWhenEmpty(t *testing.T) {
	setCache("w1|/tmp", nil)
	if !isCacheCleanerRunning() {
		t.Fatalf("expected cleaner to start on first cache entry")
	}
	if !cleanCache() {
		t.Fatalf("expected cleaner to keep running while a live entry exists")
	}
	expireCacheEntry("w1|/tmp")
	if cleanCache() {
		t.Fatalf("expected cleaner to stop once the cache is empty")
	}
	if isCacheCleanerRunning() {
		t.Fatalf("expected cleaner to be marked stopped")
	}
}
