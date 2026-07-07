// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestConnServerInitCreatesPersistentClientSymlinkDir(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	sockName := filepath.Join(homeDir, wavebase.RemoteGenieHomeDirName, wavebase.RemoteDomainSocketBaseName)
	impl := MakeRemoteRpcServerImpl(io.Discard, nil, nil, false, nil, sockName)

	err := impl.ConnServerInitCommand(context.Background(), wshrpc.CommandConnServerInitData{ClientId: "client-test"})
	if err != nil {
		t.Fatalf("ConnServerInitCommand returned error: %v", err)
	}

	wantLink := filepath.Join(
		homeDir,
		wavebase.RemoteGenieHomeDirName,
		"client",
		"client-test",
		wavebase.RemotePersistentSocketBaseName,
	)
	target, err := os.Readlink(wantLink)
	if err != nil {
		t.Fatalf("expected persistent client socket symlink %q: %v", wantLink, err)
	}
	if target != sockName {
		t.Fatalf("client symlink target = %q, want %q", target, sockName)
	}
}
