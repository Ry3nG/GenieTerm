// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/shirou/gopsutil/v4/host"
)

func hostFixture(t *testing.T, name string) string {
	t.Helper()
	text, err := os.ReadFile(filepath.Join("testdata", "hostdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(text)
}

func TestHostParsers(t *testing.T) {
	for _, tc := range []struct {
		name, input, want string
		parse             func(string) string
	}{
		{"os quoted", "NAME=x\nPRETTY_NAME=\"Ubuntu 22.04.4 LTS\"\n", "Ubuntu 22.04.4 LTS", parseOSRelease},
		{"os single", "PRETTY_NAME='Debian GNU/Linux'", "Debian GNU/Linux", parseOSRelease},
		{"os unquoted", "PRETTY_NAME=Linux", "Linux", parseOSRelease},
		{"os escapes", "PRETTY_NAME=\"Example \\\"quoted\\\" \\$OS\"", "Example \"quoted\" $OS", parseOSRelease},
		{"os missing", "# PRETTY_NAME=bad\nNAME=Linux", "", parseOSRelease},
		{"os malformed", "PRETTY_NAME=\"Linux", "", parseOSRelease},
		{"cpu x86", "Hardware: fallback\nmodel name : Intel Xeon\nmodel name: second", "Intel Xeon", parseCPUModel},
		{"cpu arm", "Hardware: BCM2711\nModel: Raspberry Pi 4", "Raspberry Pi 4", parseCPUModel},
		{"cpu hardware", "Hardware\t: ARM board", "ARM board", parseCPUModel},
		{"cpu absent", "processor: 0", "", parseCPUModel},
		{"driver multiple", " 550.54.15\n550.54.15\n", "550.54.15", parseDriverVersion},
		{"driver absent", "[N/A]\n", "", parseDriverVersion},
		{"cuda", "| NVIDIA-SMI 550.54 Driver Version: 550.54 CUDA Version: 12.4 |", "12.4", parseCUDAVersion},
		{"cuda absent", "CUDA Version: N/A", "", parseCUDAVersion},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.parse(tc.input); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestHostCache(t *testing.T) {
	for _, cancelFirst := range []bool{false, true} {
		t.Run(map[bool]string{false: "concurrent", true: "cancelled waiter"}[cancelFirst], func(t *testing.T) {
			cache := &hostInfoCache{ready: make(chan struct{})}
			started, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			collect := func(ctx context.Context) wshrpc.HostInfo {
				calls.Add(1)
				close(started)
				<-release
				return wshrpc.HostInfo{Hostname: "cached"}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			first := make(chan error, 1)
			go func() { _, err := cache.get(ctx, collect); first <- err }()
			<-started
			if cancelFirst {
				cancel()
				if err := <-first; !errors.Is(err, context.Canceled) {
					t.Fatalf("got %v", err)
				}
			}
			var wg sync.WaitGroup
			for i := 0; i < 16; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					info, err := cache.get(context.Background(), collect)
					if err != nil || info.Hostname != "cached" {
						t.Errorf("got %v %v", info, err)
					}
					info.Hostname = "private copy"
				}()
			}
			close(release)
			wg.Wait()
			if !cancelFirst {
				if err := <-first; err != nil {
					t.Fatal(err)
				}
			}
			if calls.Load() != 1 {
				t.Fatalf("collected %d times", calls.Load())
			}
			info, _ := cache.get(context.Background(), collect)
			if info.Hostname != "cached" {
				t.Fatal("cache aliased")
			}
		})
	}
}

func TestBoundedOutput(t *testing.T) {
	for _, tc := range []struct {
		limit   int
		input   string
		wantErr bool
	}{{3, "abc", false}, {3, "abcd", true}, {0, "a", true}} {
		b := &boundedOutput{limit: tc.limit}
		n, err := b.Write([]byte(tc.input))
		if (err != nil) != tc.wantErr || n != min(tc.limit, len(tc.input)) || len(b.data) > tc.limit {
			t.Fatalf("n=%d err=%v data=%q", n, err, b.data)
		}
	}
}

func TestHostCommandCancellation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX test command")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := runHostCommand(ctx, "/bin/sh", "-c", "exec sleep 10")
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > time.Second {
		t.Fatalf("err=%v elapsed=%v", err, time.Since(started))
	}
}

func TestCompleteHostOutputLines(t *testing.T) {
	for _, tc := range []struct{ input, want string }{{"abc\n123", "abc\n"}, {"abc\n", "abc\n"}, {"abc", ""}, {"", ""}} {
		if got := completeHostOutputLines(tc.input); got != tc.want {
			t.Fatalf("%q got %q", tc.input, got)
		}
	}
}

func TestHostCommandHardTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX test command")
	}
	started := time.Now()
	_, err := runHostCommand(context.Background(), "/bin/sh", "-c", "exec sleep 10")
	elapsed := time.Since(started)
	if !errors.Is(err, context.DeadlineExceeded) || elapsed < hostCommandTimeout || elapsed > hostCommandTimeout+time.Second {
		t.Fatalf("err=%v elapsed=%v", err, elapsed)
	}
}

func TestCollectHostInfo(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	info := collectHostInfo(ctx)
	if info.Hostname == "" || info.Arch != runtime.GOARCH || info.NumCpu <= 0 || info.MemTotal == 0 || info.Kernel == "" {
		t.Fatalf("incomplete host info: %+v", info)
	}
	boot, err := host.BootTimeWithContext(ctx)
	if err != nil {
		t.Logf("boot time is unavailable in this environment: %v", err)
	} else if diff := info.BootTime - int64(boot); diff < -1 || diff > 1 {
		// Windows derives boot time from uptime, so two reads can land a second apart.
		t.Fatalf("boot time = %d, want %d", info.BootTime, boot)
	}
}
