// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"testing"
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
