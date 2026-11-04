// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"encoding/base64"
	"io"
	"os/exec"
	"sync"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/utilds"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/creack/pty"
)

type blockedInputPty struct {
	pty.Pty
	entered chan struct{}
	closed  chan struct{}
	once    sync.Once
}

func (p *blockedInputPty) Write(data []byte) (int, error) {
	close(p.entered)
	<-p.closed
	return 0, io.ErrClosedPipe
}

func (p *blockedInputPty) Close() error {
	p.once.Do(func() { close(p.closed) })
	return nil
}

func TestBlockedInputAllowsSessionControl(t *testing.T) {
	for _, control := range []string{"resize", "signal", "close"} {
		t.Run(control, func(t *testing.T) {
			terminal := &blockedInputPty{entered: make(chan struct{}), closed: make(chan struct{})}
			defer terminal.Close()
			jm := &JobCmd{cmd: &exec.Cmd{}, cmdPty: terminal, termSize: waveobj.TermSize{Rows: 24, Cols: 80}}
			writeDone := make(chan error, 1)
			go func() {
				writeDone <- jm.HandleInput(wshrpc.CommandJobInputData{InputData64: base64.StdEncoding.EncodeToString([]byte("input"))})
			}()
			<-terminal.entered
			controlDone := make(chan error, 1)
			go func() {
				switch control {
				case "resize":
					controlDone <- jm.SetTermSize(waveobj.TermSize{Rows: 24, Cols: 80})
				case "signal":
					controlDone <- jm.HandleInput(wshrpc.CommandJobInputData{SigName: "SIGINT"})
				case "close":
					jm.TerminateByClosingPtyMaster()
					controlDone <- nil
				}
			}()
			select {
			case err := <-controlDone:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Errorf("%s blocked behind PTY input", control)
				terminal.Close()
				<-controlDone
			}
			terminal.Close()
			<-writeDone
		})
	}
}

func TestQueuedControlDoesNotWaitForInput(t *testing.T) {
	terminal := &blockedInputPty{entered: make(chan struct{}), closed: make(chan struct{})}
	defer terminal.Close()
	cmd := &JobCmd{cmd: &exec.Cmd{}, cmdPty: terminal, termSize: waveobj.TermSize{Rows: 24, Cols: 80}}
	manager := &JobManager{Cmd: cmd, InputQueue: utilds.MakeQuickReorderQueue[wshrpc.CommandJobInputData](4, time.Second)}
	writeDone := make(chan error, 1)
	go func() {
		writeDone <- cmd.HandleInput(wshrpc.CommandJobInputData{InputData64: "eA=="})
	}()
	<-terminal.entered
	data := wshrpc.CommandJobInputData{InputSessionId: "input", SeqNum: 1, TermSize: &waveobj.TermSize{Rows: 24, Cols: 80}}
	controlDone := make(chan error, 1)
	go func() { controlDone <- manager.QueueInput(data) }()
	select {
	case err := <-controlDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("queued resize waited for input")
	}
	queued := <-manager.InputQueue.C()
	if queued.SeqNum != 1 || queued.InputSessionId != "input" || queued.TermSize != nil {
		t.Fatalf("control must leave an empty sequence placeholder: %#v", queued)
	}
	data.SeqNum = 2
	data.InputData64 = "eQ=="
	if err := manager.QueueInput(data); err != nil {
		t.Fatal(err)
	}
	queued = <-manager.InputQueue.C()
	if queued.TermSize == nil || queued.InputData64 != "eQ==" {
		t.Fatalf("mixed input and control must retain ordering: %#v", queued)
	}
	for i := 0; i < 4; i++ {
		if err := manager.InputQueue.QueueItem("", 0, wshrpc.CommandJobInputData{}); err != nil {
			t.Fatal(err)
		}
	}
	data.InputData64 = ""
	if err := manager.QueueInput(data); err != nil {
		t.Fatalf("full data queue must not reject a completed control: %v", err)
	}
	terminal.Close()
	<-writeDone
	cmd.TerminateByClosingPtyMaster()
	if err := cmd.HandleInput(wshrpc.CommandJobInputData{InputData64: "eA=="}); err == nil {
		t.Fatal("input accepted after close")
	}
	if err := cmd.SetTermSize(waveobj.TermSize{Rows: 24, Cols: 80}); err == nil {
		t.Fatal("resize accepted after close")
	}
}
