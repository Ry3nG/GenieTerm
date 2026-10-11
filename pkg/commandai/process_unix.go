//go:build !windows

// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"os/exec"
	"syscall"
)

func setupProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}
