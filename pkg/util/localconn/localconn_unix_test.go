// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package localconn

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUnixSocketTransportAndPermissions(t *testing.T) {
	directory, err := os.MkdirTemp("", "genieterm-sock-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(directory) })
	socketPath := filepath.Join(directory, "wave.sock")
	listener, err := Listen(socketPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	info, err := os.Stat(socketPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSocket == 0 || info.Mode().Perm() != 0700 {
		t.Fatalf("socket mode = %v", info.Mode())
	}
	if listener.Addr().Network() != "unix" || listener.Addr().String() != socketPath {
		t.Fatalf("Unix endpoint changed: %v", listener.Addr())
	}
	client, server := connectPair(t, listener, socketPath)
	assertRoundTrip(t, client, server, "Unix RPC bytes 数据 \x00")
}
