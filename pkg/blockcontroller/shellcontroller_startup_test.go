// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/shellexec"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
)

func TestShellControllerCoalescesStartupResize(t *testing.T) {
	controller := MakeShellController("test-tab", "test-block", BlockController_Shell, "").(*ShellController)
	first := waveobj.TermSize{Rows: 24, Cols: 80}
	latest := waveobj.TermSize{Rows: 40, Cols: 120}
	for _, size := range []*waveobj.TermSize{&first, &latest} {
		if err := controller.SendInput(&BlockInputUnion{TermSize: size}); err != nil {
			t.Fatal(err)
		}
	}
	latest.Rows = 99
	if controller.GetRuntimeStatus().ShellProcStatus != Status_Init {
		t.Fatal("resize published running before process setup")
	}
	input := make(chan *BlockInputUnion, 32)
	outputDone := make(chan struct{})
	process := &shellexec.ShellProc{}
	controller.initializeRunningShellProcess(process, input, outputDone)
	if controller.GetRuntimeStatus().ShellProcStatus != Status_Running || controller.ShellInputCh != input || controller.ShellProc != process || controller.OutputDoneCh != outputDone {
		t.Fatal("running status published without initialized process channels")
	}
	if len(input) != 1 || controller.PendingTermSize != nil {
		t.Fatalf("startup resizes were not coalesced: queued=%d pending=%v", len(input), controller.PendingTermSize)
	}
	queued := <-input
	if queued.TermSize == nil || *queued.TermSize != (waveobj.TermSize{Rows: 40, Cols: 120}) {
		t.Fatalf("queued size = %v, want 40x120", queued.TermSize)
	}
	runningSize := waveobj.TermSize{Rows: 50, Cols: 140}
	if err := controller.SendInput(&BlockInputUnion{TermSize: &runningSize}); err != nil {
		t.Fatal(err)
	}
	if got := <-input; got.TermSize != &runningSize {
		t.Fatalf("running resize was not delivered: %v", got)
	}
}

func TestShellControllerRejectsInputBeforeStartup(t *testing.T) {
	controller := MakeShellController("test-tab", "test-block", BlockController_Shell, "").(*ShellController)
	size := waveobj.TermSize{Rows: 24, Cols: 80}
	for _, input := range []*BlockInputUnion{
		{InputData: []byte("echo unsafe\r")},
		{SigName: "TERM"},
		{InputData: []byte("echo unsafe\r"), TermSize: &size},
	} {
		if err := controller.SendInput(input); err == nil {
			t.Fatalf("input was accepted before process startup: %+v", input)
		}
	}
	controller.ProcStatus = Status_Done
	if err := controller.SendInput(&BlockInputUnion{TermSize: &size}); err == nil {
		t.Fatal("resize was accepted after process exit")
	}
}
