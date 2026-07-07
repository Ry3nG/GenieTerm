// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
)

func TestMakeRemoteUnixListenerCreatesSocketDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix sockets are not available on windows")
	}

	homeDir, err := os.MkdirTemp("/tmp", "gt-")
	if err != nil {
		t.Fatalf("failed to create short temp home: %v", err)
	}
	t.Cleanup(func() {
		os.RemoveAll(homeDir)
	})
	t.Setenv("HOME", homeDir)

	listener, err := MakeRemoteUnixListener()
	if err != nil {
		t.Fatalf("MakeRemoteUnixListener returned error: %v", err)
	}
	defer listener.Close()

	wantDir := filepath.Join(homeDir, wavebase.RemoteGenieHomeDirName)
	wantSock := filepath.Join(wantDir, wavebase.RemoteDomainSocketBaseName)

	info, err := os.Stat(wantDir)
	if err != nil {
		t.Fatalf("expected remote socket dir %q to exist: %v", wantDir, err)
	}
	if !info.IsDir() {
		t.Fatalf("expected remote socket path %q to be a directory", wantDir)
	}
	if _, err := os.Stat(wantSock); err != nil {
		t.Fatalf("expected remote socket %q to exist: %v", wantSock, err)
	}
}
