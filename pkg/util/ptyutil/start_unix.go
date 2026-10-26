// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package ptyutil

import (
	"os/exec"

	"github.com/creack/pty"
)

func StartWithSize(cmd *exec.Cmd, size *pty.Winsize) (pty.Pty, error) {
	return pty.StartWithSize(cmd, size)
}
