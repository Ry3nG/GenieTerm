// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package ptyutil

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"unicode/utf16"
	"unsafe"

	"github.com/creack/pty"
	"golang.org/x/sys/windows"
)

type windowsPty struct {
	handle      windows.Handle
	input       *os.File
	output      *os.File
	consoleOnce sync.Once
}

func (term *windowsPty) Fd() uintptr {
	return uintptr(term.handle)
}

func (term *windowsPty) Name() string {
	return term.output.Name()
}

func (term *windowsPty) Read(data []byte) (int, error) {
	n, err := term.output.Read(data)
	if err != nil {
		term.output.Close()
	}
	return n, err
}

func (term *windowsPty) Write(data []byte) (int, error) {
	return term.input.Write(data)
}

func (term *windowsPty) WriteString(data string) (int, error) {
	return term.input.WriteString(data)
}

func (term *windowsPty) finish() {
	term.consoleOnce.Do(func() {
		// ClosePseudoConsole flushes pending output. The reader must reach EOF
		// before its pipe is closed, or short commands lose their final output.
		windows.ClosePseudoConsole(term.handle)
		term.input.Close()
	})
}

func (term *windowsPty) Close() error {
	term.output.Close()
	term.finish()
	return nil
}

func makeWindowsPty(size *pty.Winsize) (*windowsPty, error) {
	output, childOutput, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	defer childOutput.Close()
	childInput, input, err := os.Pipe()
	if err != nil {
		output.Close()
		return nil, err
	}
	defer childInput.Close()
	consoleSize := windows.Coord{X: 80, Y: 24}
	if size != nil {
		consoleSize = windows.Coord{X: int16(size.Cols), Y: int16(size.Rows)}
	}
	term := &windowsPty{input: input, output: output}
	if err := windows.CreatePseudoConsole(consoleSize, windows.Handle(childInput.Fd()), windows.Handle(childOutput.Fd()), 0, &term.handle); err != nil {
		input.Close()
		output.Close()
		return nil, err
	}
	return term, nil
}

func StartWithSize(cmd *exec.Cmd, size *pty.Winsize) (_ pty.Pty, err error) {
	if cmd.Err != nil {
		return nil, cmd.Err
	}
	if cmd.Process != nil {
		return nil, errors.New("exec: already started")
	}
	if cmd.Cancel != nil {
		return nil, errors.New("terminal process does not support exec.CommandContext cancellation")
	}
	if cmd.Path == "" {
		return nil, errors.New("exec: no command")
	}
	executable := cmd.Path
	if !filepath.IsAbs(executable) && cmd.Dir != "" {
		executable = filepath.Join(cmd.Dir, executable)
	}
	executable, err = exec.LookPath(executable)
	if err != nil {
		return nil, err
	}
	application, err := windows.UTF16PtrFromString(executable)
	if err != nil {
		return nil, err
	}
	var directory *uint16
	if cmd.Dir != "" {
		directory, err = windows.UTF16PtrFromString(cmd.Dir)
		if err != nil {
			return nil, err
		}
	}
	attrs := cmd.SysProcAttr
	if attrs == nil {
		attrs = &syscall.SysProcAttr{}
	}
	args := cmd.Args
	if len(args) == 0 {
		args = []string{cmd.Path}
	}
	commandLine := attrs.CmdLine
	if commandLine == "" {
		commandLine = windows.ComposeCommandLine(args)
	}
	command, err := windows.UTF16PtrFromString(commandLine)
	if err != nil {
		return nil, err
	}
	env := cmd.Environ()
	for _, entry := range env {
		if strings.ContainsRune(entry, 0) {
			return nil, errors.New("exec: environment variable contains NUL")
		}
	}
	environment := utf16.Encode([]rune(strings.Join(env, "\x00") + "\x00\x00"))
	term, err := makeWindowsPty(size)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			term.Close()
		}
	}()
	attributeList, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return nil, err
	}
	defer attributeList.Delete()
	consoleHandle := *(*unsafe.Pointer)(unsafe.Pointer(&term.handle))
	if err = attributeList.Update(windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, consoleHandle, unsafe.Sizeof(term.handle)); err != nil {
		return nil, err
	}
	startup := &windows.StartupInfoEx{ProcThreadAttributeList: attributeList.List()}
	startup.Cb = uint32(unsafe.Sizeof(*startup))
	startup.Flags = windows.STARTF_USESTDHANDLES
	if attrs.HideWindow {
		startup.Flags |= windows.STARTF_USESHOWWINDOW
		startup.ShowWindow = windows.SW_HIDE
	}
	flags := attrs.CreationFlags | windows.CREATE_UNICODE_ENVIRONMENT | windows.EXTENDED_STARTUPINFO_PRESENT
	process := &windows.ProcessInformation{}
	if attrs.Token != 0 {
		err = windows.CreateProcessAsUser(windows.Token(attrs.Token), application, command, nil, nil, false, flags, &environment[0], directory, &startup.StartupInfo, process)
	} else {
		err = windows.CreateProcess(application, command, nil, nil, false, flags, &environment[0], directory, &startup.StartupInfo, process)
	}
	if err != nil {
		return nil, fmt.Errorf("start terminal process: %w", err)
	}
	windows.CloseHandle(process.Thread)
	cmd.Process, err = os.FindProcess(int(process.ProcessId))
	if err != nil {
		windows.TerminateProcess(process.Process, 1)
		windows.CloseHandle(process.Process)
		return nil, err
	}
	// ConPTY needs cleanup on exit, but reaping cmd.Process here would consume the
	// exit status before exec.Cmd.Wait can observe a short-lived shell.
	go func() {
		defer windows.CloseHandle(process.Process)
		windows.WaitForSingleObject(process.Process, windows.INFINITE)
		term.finish()
	}()
	return term, nil
}
