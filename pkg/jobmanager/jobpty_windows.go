// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package jobmanager

import "github.com/creack/pty"

func makeCancelablePty(terminal pty.Pty) (pty.Pty, error) {
	return terminal, nil
}
