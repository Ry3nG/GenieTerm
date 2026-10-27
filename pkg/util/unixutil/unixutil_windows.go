// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package unixutil

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func GetProcessGroupId(pid int) (int, error) {
	return 0, fmt.Errorf("process group id not supported on windows")
}

func ParseSignal(sigName string) os.Signal {
	return nil
}

func GetSignalName(sig os.Signal) string {
	if sig == nil {
		return ""
	}
	return sig.String()
}

func SetCloseOnExec(fd int) {
}

func SignalTerm(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return proc.Kill()
}

// this is a no-op on windows
func SignalHup(pid int) error {
	return nil
}

func IsPidRunning(pid int) bool {
	if pid <= 0 || uint64(pid) > uint64(^uint32(0)) {
		return false
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		// An inaccessible process still exists, matching the Unix EPERM behavior.
		return errors.Is(err, windows.ERROR_ACCESS_DENIED)
	}
	defer windows.CloseHandle(handle)
	state, err := windows.WaitForSingleObject(handle, 0)
	// Do not clear a badge unless a successfully opened process has exited.
	return err != nil || state != windows.WAIT_OBJECT_0
}

func SendSignalByName(pid int, sigName string) error {
	return fmt.Errorf("sending signals is not supported on Windows")
}
