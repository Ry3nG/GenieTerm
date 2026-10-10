// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestGPUNumber(t *testing.T) {
	for _, tc := range []struct {
		text        string
		scale, want float64
	}{
		{"1.5", gpuMiB, 1572864}, {"0", gpuMiB, 0}, {"[N/A]", gpuMiB, -1}, {"N/A", 1, -1}, {"[Not Supported]", 1, -1}, {"", 1, -1}, {"NaN", 1, -1}, {"+Inf", 1, -1}, {"-2", 1, -1}, {"1e308", gpuMiB, -1},
	} {
		t.Run(tc.text, func(t *testing.T) {
			if got := gpuNumber(tc.text, tc.scale); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestGPUParsers(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		count      int
		bad        bool
	}{
		{"fixture", hostFixture(t, "gpus.csv"), 2, false}, {"empty", "", 0, false}, {"malformed", "0,broken", 0, true}, {"invalid identity", "x,u,n,1,2,3,4,5,6,7,8,9,10,11,P0", 0, true}, {"old field count", "0,GPU-a,n,1,2,3,4,5,6", 0, true}, {"no device", "No devices were found", 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, err := parseGPUs(tc.text)
			if (err != nil) != tc.bad || len(rows) != tc.count {
				t.Fatalf("rows=%v err=%v", rows, err)
			}
			if tc.name == "fixture" {
				if rows[0].data.Name != "NVIDIA A100, PCIe" || rows[0].data.MemUsed != 1572864 || rows[1].data.Temp != -1 {
					t.Fatalf("rows=%+v", rows)
				}
				a, b := rows[0].data, rows[1].data
				if a.MemUtil != 10 || a.Fan != -1 || a.ClockSm != 1410 || a.ClockSmMax != 1410 || a.ClockMem != 1593 || a.Pstate != "P0" {
					t.Fatalf("extended fields = %+v", a)
				}
				if b.MemUtil != -1 || b.Fan != 35 || b.Pstate != "" {
					t.Fatalf("missing extended fields = %+v", b)
				}
			}
		})
	}
	devices, _ := parseGPUs(hostFixture(t, "gpus.csv"))
	var many strings.Builder
	for i := 1; i <= 50; i++ {
		fmt.Fprintf(&many, "GPU-a,%d,%d\n", i, i)
	}
	for _, tc := range []struct {
		name, text string
		count      int
		first      int32
		bad        bool
	}{
		{"fixture", hostFixture(t, "gpuprocesses.csv"), 2, 124, false}, {"bounded", many.String(), 32, 50, false}, {"empty", "", 0, 0, false}, {"malformed", "GPU-a,1", 0, 0, true}, {"bad pid", "GPU-a,0,1\nGPU-a,-1,2\nGPU-a,99999999999,3", 0, 0, false},
	} {
		t.Run(tc.name+" processes", func(t *testing.T) {
			rows, err := parseGPUProcesses(tc.text, devices)
			if (err != nil) != tc.bad || len(rows["GPU-a"]) != tc.count {
				t.Fatalf("rows=%v err=%v", rows, err)
			}
			if tc.count > 0 && rows["GPU-a"][0].Pid != tc.first {
				t.Fatalf("wrong sort: %v", rows)
			}
			if tc.name == "fixture" && rows["GPU-b"][0].MemUsed != -1 {
				t.Fatal("missing memory not preserved")
			}
		})
	}
}

func TestNvidiaBinaryCache(t *testing.T) {
	for _, present := range []bool{false, true} {
		t.Run(fmt.Sprint(present), func(t *testing.T) {
			var calls atomic.Int32
			cache := &nvidiaBinaryCache{lookup: func(name string) (string, error) {
				calls.Add(1)
				if present && name == "/usr/lib/wsl/lib/nvidia-smi" {
					return name, nil
				}
				return "", errors.New("missing")
			}}
			now := time.Now()
			var wg sync.WaitGroup
			for i := 0; i < 20; i++ {
				wg.Add(1)
				go func() { defer wg.Done(); cache.find(now) }()
			}
			wg.Wait()
			if calls.Load() != 4 {
				t.Fatalf("looked up %d times", calls.Load())
			}
			cache.find(now.Add(gpuBinaryRetry - time.Nanosecond))
			if calls.Load() != 4 {
				t.Fatal("retried too soon")
			}
			cache.find(now.Add(gpuBinaryRetry))
			want := int32(8)
			if present {
				want = 4
			}
			if calls.Load() != want {
				t.Fatalf("got %d lookups", calls.Load())
			}
		})
	}
}

func TestGPUFreshnessAndBackoff(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		name   string
		active bool
		age    time.Duration
		want   int
	}{{"fresh", true, gpuFreshness - time.Nanosecond, 1}, {"boundary", true, gpuFreshness, 0}, {"stale", true, time.Minute, 0}, {"idle", false, 0, 0}} {
		t.Run(tc.name, func(t *testing.T) {
			s := &gpuSampler{active: tc.active, sampled: now.Add(-tc.age), cached: []wshrpc.GpuData{{Index: 1}}}
			if got := len(s.latest(now)); got != tc.want {
				t.Fatalf("got %d", got)
			}
		})
	}
	for _, tc := range []struct {
		failures int
		want     time.Duration
	}{{0, gpuSampleInterval}, {1, gpuSampleInterval}, {2, gpuSampleInterval}, {3, gpuFailureBackoff}, {100, gpuFailureBackoff}} {
		if got := gpuRetryDelay(tc.failures); got != tc.want {
			t.Fatalf("%d: %v", tc.failures, got)
		}
	}
}

func gpuRunning(s *gpuSampler) bool { s.lock.Lock(); defer s.lock.Unlock(); return s.cancel != nil }
func waitGPUStopped(t *testing.T, s *gpuSampler) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for gpuRunning(s) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if gpuRunning(s) {
		t.Fatal("sampler did not stop")
	}
}

func TestGPUSamplerLifecycle(t *testing.T) {
	for _, restart := range []bool{false, true} {
		t.Run(fmt.Sprint(restart), func(t *testing.T) {
			started := make(chan struct{}, 4)
			release := make(chan struct{})
			var running, peak atomic.Int32
			s := &gpuSampler{collect: func(ctx context.Context) ([]wshrpc.GpuData, error) {
				n := running.Add(1)
				defer running.Add(-1)
				if n > peak.Load() {
					peak.Store(n)
				}
				started <- struct{}{}
				<-ctx.Done()
				<-release
				return nil, ctx.Err()
			}}
			defer func() { s.setActive(false); waitGPUStopped(t, s) }()
			var wg sync.WaitGroup
			for i := 0; i < 20; i++ {
				wg.Add(1)
				go func() { defer wg.Done(); s.setActive(true) }()
			}
			wg.Wait()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("no sampler")
			}
			start := time.Now()
			_ = s.latest(time.Now())
			s.setActive(false)
			if time.Since(start) > 100*time.Millisecond {
				t.Fatal("reader/stop blocked on sampler")
			}
			if restart {
				s.setActive(true)
			}
			close(release)
			if restart {
				select {
				case <-started:
				case <-time.After(gpuSampleInterval + time.Second):
					t.Fatal("restart lost")
				}
				s.setActive(false)
			}
			waitGPUStopped(t, s)
			if peak.Load() != 1 {
				t.Fatalf("overlapping workers: %d", peak.Load())
			}
		})
	}
}

func TestGPUCancelledPublication(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		t.Run(fmt.Sprint(cancelled), func(t *testing.T) {
			s := &gpuSampler{active: true}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if cancelled {
				cancel()
			}
			s.store(ctx, []wshrpc.GpuData{{Index: 1}}, nil, time.Now(), time.Now())
			if (len(s.latest(time.Now())) == 0) != cancelled {
				t.Fatal("publication ignored cancellation")
			}
		})
	}
}

func TestGPURetryState(t *testing.T) {
	for _, tc := range []struct {
		name     string
		failures int
		success  bool
		want     time.Duration
	}{
		{"first failure", 0, false, gpuSampleInterval}, {"third failure", 2, false, gpuFailureBackoff}, {"repeated failure", 3, false, gpuFailureBackoff}, {"recovery", 3, true, gpuSampleInterval},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Now()
			s := &gpuSampler{active: true, failures: tc.failures}
			var err error
			if !tc.success {
				err = errors.New("driver unavailable")
			}
			s.store(context.Background(), []wshrpc.GpuData{{Index: 1}}, err, now.Add(-gpuFreshness), now)
			if got := s.sampleDelay(now); got != tc.want {
				t.Fatalf("delay=%v want=%v", got, tc.want)
			}
			if got := s.latest(now); got != nil {
				t.Fatal("published stale GPU reading")
			}
			s.setActive(false)
			if got := s.sampleDelay(now); got != tc.want {
				t.Fatal("idle reset retry delay")
			}
			if tc.success && s.failures != 0 {
				t.Fatal("success did not reset failure count")
			}
		})
	}
}

func TestGPUBackoffCancellation(t *testing.T) {
	for _, backoff := range []time.Duration{gpuSampleInterval, gpuFailureBackoff} {
		t.Run(backoff.String(), func(t *testing.T) {
			var calls atomic.Int32
			s := &gpuSampler{nextAttempt: time.Now().Add(backoff), collect: func(context.Context) ([]wshrpc.GpuData, error) { calls.Add(1); return nil, nil }}
			s.setActive(true)
			time.Sleep(10 * time.Millisecond)
			s.setActive(false)
			waitGPUStopped(t, s)
			if calls.Load() != 0 {
				t.Fatal("sampler ignored retry delay")
			}
		})
	}
}
