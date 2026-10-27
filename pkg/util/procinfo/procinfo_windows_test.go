// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package procinfo

import (
	"context"
	"errors"
	"os"
	"os/user"
	"testing"
)

func TestWindowsCurrentProcessInfo(t *testing.T) {
	snapshot, err := MakeGlobalSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	info, err := GetProcInfo(context.Background(), snapshot, int32(os.Getpid()))
	if err != nil {
		t.Fatal(err)
	}
	if info.Command == "" || info.Ppid != int32(os.Getppid()) || info.NumThreads <= 0 {
		t.Fatalf("invalid process identity: %+v", info)
	}
	if info.CpuUser < 0 || info.CpuSys < 0 || info.VmRSS <= 0 {
		t.Fatalf("current process resource usage unavailable: %+v", info)
	}
	account, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	if info.User == "" || info.User != account.Username {
		t.Fatalf("current process user = %q, native account = %q", info.User, account.Username)
	}
	if _, err := GetProcInfo(context.Background(), snapshot, -1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing process error = %v, want ErrNotFound", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := GetProcInfo(ctx, snapshot, int32(os.Getpid())); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled process lookup = %v", err)
	}
}
