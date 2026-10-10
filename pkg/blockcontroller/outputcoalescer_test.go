// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"sync"
	"testing"
	"time"
)

type flushRecorder struct {
	lock    sync.Mutex
	flushes []string
}

func (r *flushRecorder) flush(data []byte) {
	r.lock.Lock()
	defer r.lock.Unlock()
	r.flushes = append(r.flushes, string(data))
}

func (r *flushRecorder) get() []string {
	r.lock.Lock()
	defer r.lock.Unlock()
	return append([]string(nil), r.flushes...)
}

func waitForFlushes(t *testing.T, r *flushRecorder, count int) []string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if flushes := r.get(); len(flushes) >= count {
			return flushes
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("expected %d flushes, got %q", count, r.get())
	return nil
}

func TestOutputCoalescerForwardsFirstChunkAndBatchesTheBurst(t *testing.T) {
	rec := &flushRecorder{}
	c := MakeOutputCoalescer(50*time.Millisecond, 1024, rec.flush)
	buf := []byte("a")
	c.Write(buf)
	if got := rec.get(); len(got) != 1 || got[0] != "a" {
		t.Fatalf("first chunk should be forwarded immediately, got %q", got)
	}
	for _, chunk := range []string{"b", "c", "d"} {
		copy(buf, chunk)
		c.Write(buf)
	}
	flushes := waitForFlushes(t, rec, 2)
	if flushes[1] != "bcd" {
		t.Fatalf("burst should be one flush, got %q", flushes)
	}
}

func TestOutputCoalescerFlushesAtMaxBytesAndOnClose(t *testing.T) {
	rec := &flushRecorder{}
	c := MakeOutputCoalescer(time.Hour, 4, rec.flush)
	c.Write([]byte("x"))
	c.Write([]byte("12"))
	c.Write([]byte("34"))
	c.Write([]byte("5"))
	c.Close()
	c.Write([]byte("after"))
	got := rec.get()
	want := []string{"x", "1234", "5", "after"}
	if len(got) != len(want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %q, want %q", got, want)
		}
	}
}

func TestOutputCoalescerReturnsToIdleAfterAQuietWindow(t *testing.T) {
	rec := &flushRecorder{}
	c := MakeOutputCoalescer(10*time.Millisecond, 1024, rec.flush)
	c.Write([]byte("a"))
	time.Sleep(60 * time.Millisecond)
	c.Write([]byte("b"))
	if got := rec.get(); len(got) != 2 || got[1] != "b" {
		t.Fatalf("a write after a quiet window should be forwarded immediately, got %q", got)
	}
}
