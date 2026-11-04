// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package jobmanager

import (
	"os"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
)

type cancelablePty struct {
	*os.File
	fd uintptr
}

// os.File.Fd switches a pollable file back to blocking mode; PTY resize needs
// the descriptor without undoing the runtime poller used to cancel blocked I/O.
func (p *cancelablePty) Fd() uintptr {
	return p.fd
}

func makeCancelablePty(terminal pty.Pty) (pty.Pty, error) {
	defer terminal.Close()
	fd, err := unix.FcntlInt(terminal.Fd(), unix.F_DUPFD_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	if err := unix.SetNonblock(fd, true); err != nil {
		unix.Close(fd)
		return nil, err
	}
	// Register the nonblocking descriptor with Go's poller before any I/O starts.
	return &cancelablePty{File: os.NewFile(uintptr(fd), terminal.Name()), fd: uintptr(fd)}, nil
}
