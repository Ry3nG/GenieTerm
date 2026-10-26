// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package ptyutil

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/creack/pty"
	"golang.org/x/sys/windows"
)

type processReport struct {
	Directory string
	Args      []string
	Env       string
}

func TestWindowsTerminalHelper(t *testing.T) {
	if os.Getenv("GENIETERM_TEST_PTY_HELPER") != "1" {
		return
	}
	if os.Getenv("GENIETERM_TEST_PTY_ABANDON") == "1" {
		fmt.Printf("%s", strings.Repeat("large output without a reader\r\n", 100000))
		os.Exit(0)
	}
	dir, err := os.Getwd()
	if err != nil {
		os.Exit(99)
	}
	data, _ := json.Marshal(processReport{Directory: dir, Args: os.Args[3:], Env: os.Getenv("GENIETERM_TEST_PTY_VALUE")})
	fmt.Printf("__PTY_REPORT__%s__\n", base64.StdEncoding.EncodeToString(data))
	os.Exit(7)
}

func TestWindowsTerminalArgumentsEnvironmentAndDirectory(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "Unicode 空间 and spaces")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	program := filepath.Join(directory, "terminal helper.exe")
	source, err := os.Open(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	dest, err := os.Create(program)
	if err != nil {
		t.Fatal(err)
	}
	_, copyErr := io.Copy(dest, source)
	closeErr := dest.Close()
	if copyErr != nil || closeErr != nil {
		t.Fatalf("copy test helper: %v, %v", copyErr, closeErr)
	}
	args := []string{"", "two words", `quote"inside`, `trailing\`, "你好"}
	cmd := exec.Command(program, append([]string{"-test.run=^TestWindowsTerminalHelper$", "--"}, args...)...)
	cmd.Dir = directory
	cmd.Env = append(os.Environ(), "GENIETERM_TEST_PTY_HELPER=1", "GENIETERM_TEST_PTY_VALUE=用户 value with spaces")
	term, err := StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { term.Close() })
	if err := cmd.Wait(); err == nil || cmd.ProcessState == nil || cmd.ProcessState.ExitCode() != 7 {
		t.Fatalf("wait lost exit status: %v (%v)", err, cmd.ProcessState)
	}
	output := make(chan []byte, 1)
	go func() {
		data, _ := io.ReadAll(term)
		output <- data
	}()
	var data []byte
	select {
	case data = <-output:
	case <-time.After(10 * time.Second):
		cmd.Process.Kill()
		cmd.Wait()
		t.Fatal("terminal did not exit")
	}
	_, encoded, ok := strings.Cut(string(data), "__PTY_REPORT__")
	if !ok {
		t.Fatalf("process report missing from terminal output: %q", data)
	}
	encoded, _, ok = strings.Cut(encoded, "__")
	if !ok {
		t.Fatalf("process report truncated: %q", data)
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var report processReport
	if err := json.Unmarshal(decoded, &report); err != nil {
		t.Fatal(err)
	}
	want := processReport{Directory: directory, Args: args, Env: "用户 value with spaces"}
	if !reflect.DeepEqual(report, want) {
		t.Fatalf("process report = %#v, want %#v", report, want)
	}
	if err := term.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestWindowsTerminalRejectsUnmanagedCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0])
	if _, err := StartWithSize(cmd, nil); err == nil || cmd.Process != nil {
		t.Fatalf("context command started without cancellation support: %v", err)
	}
}

func TestWindowsTerminalCloseWithoutReader(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestWindowsTerminalHelper$", "--")
	cmd.Env = append(os.Environ(), "GENIETERM_TEST_PTY_HELPER=1", "GENIETERM_TEST_PTY_ABANDON=1")
	term, err := StartWithSize(cmd, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cmd.Process.Kill()
		cmd.Wait()
	})
	peek := windows.NewLazySystemDLL("kernel32.dll").NewProc("PeekNamedPipe")
	deadline := time.Now().Add(10 * time.Second)
	for {
		var available uint32
		ok, _, err := peek.Call(term.(*windowsPty).output.Fd(), 0, 0, 0, uintptr(unsafe.Pointer(&available)), 0)
		if ok == 0 {
			term.Close()
			t.Fatalf("check unread terminal output: %v", err)
		}
		if available >= 1024 {
			break
		}
		if time.Now().After(deadline) {
			term.Close()
			t.Fatal("terminal did not produce unread output")
		}
		time.Sleep(10 * time.Millisecond)
	}
	done := make(chan error, 1)
	go func() { done <- term.Close() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("closing a terminal with no output reader blocked")
	}
}
