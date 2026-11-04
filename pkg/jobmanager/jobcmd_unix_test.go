// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package jobmanager

import (
	"bytes"
	"encoding/base64"
	"io"
	"os"
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
	jm := &JobCmd{cmd: cmd, cmdPty: terminal, termSize: waveobj.TermSize{Rows: 24, Cols: 80}}
	waitDone := make(chan struct{})
	go func() {
		jm.waitForProcess()
		close(waitDone)
	}()
	t.Cleanup(func() {
		cmd.Process.Kill()
		terminal.Close()
		<-waitDone
	})
	ready := make([]byte, 5)
	if _, err := io.ReadFull(terminal, ready); err != nil || string(ready) != "ready" {
		t.Fatalf("child readiness: %q, %v", ready, err)
	}
	readDone := make(chan error, 1)
	go func() {
		_, err := io.Copy(io.Discard, terminal)
		readDone <- err
	}()
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
	case <-waitDone:
	case <-time.After(time.Second):
		t.Fatal("child failed to exit")
	}
	select {
	case <-readDone:
	case <-time.After(time.Second):
		t.Fatal("reader failed to exit")
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

func TestExitedProcessPreservesPendingOutput(t *testing.T) {
	// A pipe retains unread output after exit; Darwin may drain a PTY while
	// closing the slave, before Wait can return.
	terminal, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	defer writer.Close()
	if _, err := writer.WriteString("final-output"); err != nil {
		t.Fatal(err)
	}
	writer.Close()
	cmd := exec.Command("/bin/sh", "-c", "exit 0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	jm := &JobCmd{cmd: cmd, cmdPty: terminal}
	jm.waitForProcess()
	output, _ := io.ReadAll(terminal)
	if string(output) != "final-output" {
		t.Fatalf("output was lost after process exit: %q", output)
	}
	if err := jm.HandleInput(wshrpc.CommandJobInputData{InputData64: "eA=="}); err == nil {
		t.Fatal("input accepted after process exit")
	}
}
