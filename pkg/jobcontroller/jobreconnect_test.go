// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunBoundedLimitsConcurrency(t *testing.T) {
	var inFlight atomic.Int32
	var maxSeen atomic.Int32
	var mu sync.Mutex
	seen := make(map[string]bool)
	items := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	runBounded(items, 3, func(item string) {
		cur := inFlight.Add(1)
		for {
			prev := maxSeen.Load()
			if cur <= prev || maxSeen.CompareAndSwap(prev, cur) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		inFlight.Add(-1)
		mu.Lock()
		seen[item] = true
		mu.Unlock()
	})
	if maxSeen.Load() > 3 {
		t.Fatalf("concurrency exceeded limit: %d", maxSeen.Load())
	}
	if len(seen) != len(items) {
		t.Fatalf("not all items processed: %v", seen)
	}
}

func TestRetryWithDelays(t *testing.T) {
	var slept []time.Duration
	sleepFn := func(d time.Duration) { slept = append(slept, d) }
	attempts := 0
	err := retryWithDelays(3, []time.Duration{time.Second, 3 * time.Second}, sleepFn, func(attempt int) (bool, error) {
		attempts++
		return false, fmt.Errorf("fail %d", attempt)
	})
	if attempts != 3 || err == nil || err.Error() != "fail 3" {
		t.Fatalf("attempts=%d err=%v", attempts, err)
	}
	if fmt.Sprint(slept) != fmt.Sprint([]time.Duration{time.Second, 3 * time.Second}) {
		t.Fatalf("unexpected sleeps %v", slept)
	}

	slept = nil
	attempts = 0
	err = retryWithDelays(5, []time.Duration{time.Second}, sleepFn, func(attempt int) (bool, error) {
		attempts++
		if attempt == 2 {
			return true, nil
		}
		return false, errors.New("transient")
	})
	if err != nil || attempts != 2 || len(slept) != 1 {
		t.Fatalf("expected success on 2nd attempt: attempts=%d err=%v slept=%v", attempts, err, slept)
	}

	attempts = 0
	err = retryWithDelays(5, nil, sleepFn, func(attempt int) (bool, error) {
		attempts++
		return true, errors.New("fatal")
	})
	if attempts != 1 || err == nil {
		t.Fatalf("non-retryable error should stop immediately: attempts=%d err=%v", attempts, err)
	}
}

func TestJobStreamSupersede(t *testing.T) {
	js := &jobStream{}
	if old := js.swap("s1", nil); old != nil {
		t.Fatalf("unexpected old reader")
	}
	ran := false
	if !js.runIfCurrent("s1", func() { ran = true }) || !ran {
		t.Fatalf("current stream should run")
	}
	js.swap("s2", nil)
	ran = false
	if js.runIfCurrent("s1", func() { ran = true }) || ran {
		t.Fatalf("superseded stream must not append")
	}
}

// restartStreaming holds the stream lock across "stat + switch stream"; an output loop of
// the old stream must either finish its append before the switch or skip it entirely.
func TestJobStreamAppendSerializedWithSwap(t *testing.T) {
	js := &jobStream{}
	js.swap("old", nil)
	var appendsAfterSwap atomic.Int32
	var swapped atomic.Bool
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			js.runIfCurrent("old", func() {
				if swapped.Load() {
					appendsAfterSwap.Add(1)
				}
			})
		}
	}()
	time.Sleep(time.Millisecond)
	js.lock.Lock()
	swapped.Store(true)
	js.swap_withlock("new", nil)
	js.lock.Unlock()
	wg.Wait()
	if appendsAfterSwap.Load() != 0 {
		t.Fatalf("old stream appended %d times after swap", appendsAfterSwap.Load())
	}
}
