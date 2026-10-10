// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestWaitForJobStartTimesOut(t *testing.T) {
	start := time.Now()
	if waitForJobStart(150*time.Millisecond, func() bool { return false }) {
		t.Fatalf("expected timeout")
	}
	if elapsed := time.Since(start); elapsed < 150*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("unexpected wait duration %v", elapsed)
	}
}

func TestWaitForJobStartReturnsWhenStarted(t *testing.T) {
	var started atomic.Bool
	time.AfterFunc(50*time.Millisecond, func() { started.Store(true) })
	start := time.Now()
	if !waitForJobStart(5*time.Second, started.Load) {
		t.Fatalf("expected start to be detected")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("start detection too slow: %v", time.Since(start))
	}
}
