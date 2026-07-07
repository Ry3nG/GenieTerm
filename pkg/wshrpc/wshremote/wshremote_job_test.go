// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
)

func TestDialJobManagerSocketFallsBackToLegacyWaveSocket(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix sockets are not available on windows")
	}

	jobId := "legacy-job-socket-test"
	primaryPath := wavebase.GetRemoteJobSocketPath(jobId)
	legacyPath := wavebase.GetLegacyRemoteJobSocketPath(jobId)
	os.Remove(primaryPath)
	os.Remove(legacyPath)
	t.Cleanup(func() {
		os.Remove(primaryPath)
		os.Remove(legacyPath)
	})

	if err := os.MkdirAll(filepath.Dir(legacyPath), 0700); err != nil {
		t.Fatalf("failed to create legacy socket dir: %v", err)
	}
	listener, err := net.Listen("unix", legacyPath)
	if err != nil {
		t.Fatalf("failed to listen on legacy socket: %v", err)
	}
	defer listener.Close()

	accepted := make(chan struct{})
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			conn.Close()
			close(accepted)
		}
	}()

	conn, socketPath, err := dialJobManagerSocket(jobId)
	if err != nil {
		t.Fatalf("dialJobManagerSocket returned error: %v", err)
	}
	defer conn.Close()
	if socketPath != legacyPath {
		t.Fatalf("socket path = %q, want legacy path %q", socketPath, legacyPath)
	}

	select {
	case <-accepted:
	case <-time.After(2 * time.Second):
		t.Fatal("legacy socket listener did not accept a connection")
	}
}
