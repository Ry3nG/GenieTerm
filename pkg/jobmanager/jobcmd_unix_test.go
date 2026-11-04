// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package jobmanager

import (
	"bytes"
	"encoding/base64"
	"io"
	"os/exec"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/util/ptyutil"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/creack/pty"
)

func TestRealPtyBlockedInputControl(t *testing.T) {
	for _, action := range []string{"close", "signal"} {
		t.Run(action, func(t *testing.T) { testRealPtyBlockedInputControl(t, action) })
	}
}

func testRealPtyBlockedInputControl(t *testing.T, action string) {
	cmd := exec.Command("/bin/sh", "-c", "stty raw -echo; printf ready; exec sleep 30")
	terminal, err := ptyutil.StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 80})
	if err != nil {
		t.Fatal(err)
	}
	terminal, err = makeCancelablePty(terminal)
	if err != nil {
		cmd.Process.Kill()
		cmd.Wait()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cmd.Process.Kill()
		terminal.Close()
		cmd.Wait()
	})
	ready := make([]byte, 5)
	if _, err := io.ReadFull(terminal, ready); err != nil || string(ready) != "ready" {
		t.Fatalf("child readiness: %q, %v", ready, err)
	}
	jm := &JobCmd{cmd: cmd, cmdPty: terminal, termSize: waveobj.TermSize{Rows: 24, Cols: 80}}
	if err := jm.SetTermSize(waveobj.TermSize{Rows: 30, Cols: 100}); err != nil {
		t.Fatal(err)
	}
	writeDone := make(chan error, 1)
	go func() {
		writeDone <- jm.HandleInput(wshrpc.CommandJobInputData{
			InputData64: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("x"), 2*1024*1024)),
		})
	}()
	select {
	case err := <-writeDone:
		t.Fatalf("expected backpressure from a child not reading stdin, got %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	resized := make(chan error, 1)
	go func() { resized <- jm.SetTermSize(waveobj.TermSize{Rows: 40, Cols: 120}) }()
	select {
	case err := <-resized:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("resizing a real PTY blocked behind input")
	}
	controlled := make(chan error, 1)
	go func() {
		if action == "signal" {
			controlled <- jm.HandleInput(wshrpc.CommandJobInputData{SigName: "SIGTERM"})
			return
		}
		jm.TerminateByClosingPtyMaster()
		controlled <- nil
	}()
	select {
	case err := <-controlled:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		cmd.Process.Kill()
		<-controlled
		t.Fatalf("%s of a real PTY blocked behind input", action)
	}
	select {
	case err := <-writeDone:
		if err == nil {
			t.Fatal("blocked input succeeded after session ended")
		}
	case <-time.After(time.Second):
		t.Fatal("ending the session did not cancel blocked input")
	}
}
