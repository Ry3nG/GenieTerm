// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestRemoteFileInfoCommandServesLocalFilesFromMainServer(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "upload-source.txt")
	if err := os.WriteFile(path, []byte("upload source\n"), 0644); err != nil {
		t.Fatalf("failed to write source file: %v", err)
	}

	info, err := WshServerImpl.RemoteFileInfoCommand(context.Background(), path)
	if err != nil {
		t.Fatalf("failed to get file info: %v", err)
	}
	if info.NotFound {
		t.Fatalf("expected file to exist")
	}
	if info.Name != "upload-source.txt" {
		t.Fatalf("expected basename upload-source.txt, got %q", info.Name)
	}
	if info.Size != int64(len("upload source\n")) {
		t.Fatalf("expected size %d, got %d", len("upload source\n"), info.Size)
	}
}

func TestRemoteListEntriesCommandServesLocalFoldersFromMainServer(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for resp := range WshServerImpl.RemoteListEntriesCommand(context.Background(), wshrpc.CommandRemoteListEntriesData{Path: dir}) {
		if resp.Error != nil {
			t.Fatalf("list entries: %v", resp.Error)
		}
		for _, info := range resp.Response.FileInfo {
			names[info.Name] = info.IsDir
		}
	}
	if len(names) != 2 || names["a.txt"] || !names["sub"] {
		t.Fatalf("unexpected entries: %#v", names)
	}
}
