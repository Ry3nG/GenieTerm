// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package unixutil

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsProcessLivenessHelper(t *testing.T) {
	if os.Getenv("GENIETERM_TEST_PID_HELPER") != "1" {
		return
	}
	fmt.Printf("ready\n")
	io.Copy(io.Discard, os.Stdin)
	os.Exit(0)
}

func TestWindowsIsPidRunning(t *testing.T) {
	for _, pid := range []int{0, -1} {
		if IsPidRunning(pid) {
			t.Fatalf("invalid PID %d reported running", pid)
		}
	}
	if !IsPidRunning(os.Getpid()) {
		t.Error("current test process reported stopped")
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "-test.run=^TestWindowsProcessLivenessHelper$")
	cmd.Env = append(os.Environ(), "GENIETERM_TEST_PID_HELPER=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		stdin.Close()
		if cmd.ProcessState == nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	ready, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || ready != "ready\n" {
		t.Fatalf("child readiness = %q, err=%v", ready, err)
	}
	pid := cmd.Process.Pid
	// Retaining a handle prevents PID reuse while testing the exited process.
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	if !IsPidRunning(pid) {
		t.Error("live child process reported stopped")
	}
	if err := stdin.Close(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if IsPidRunning(pid) {
		t.Fatal("exited child process reported running")
	}
}
