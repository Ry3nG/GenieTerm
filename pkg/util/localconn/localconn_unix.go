// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package localconn

import (
	"net"
	"os"
)

func Listen(socketPath string) (net.Listener, error) {
	os.Remove(socketPath) // ignore error
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, err
	}
	os.Chmod(socketPath, 0700)
	return listener, nil
}

func Dial(socketPath string) (net.Conn, error) {
	return net.Dial("unix", socketPath)
}
