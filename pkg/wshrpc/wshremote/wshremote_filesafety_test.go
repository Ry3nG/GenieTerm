// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/remote/fileshare/fsutil"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func localTestURI(p string) string {
	return "wsh://local/" + strings.TrimPrefix(filepath.ToSlash(p), "/")
}

func TestRemoteFileCopyCommandRequiresOverwriteAndReplacesAtomically(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dest := filepath.Join(dir, "dest.txt")
	if err := os.WriteFile(src, []byte("new contents"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	impl := &ServerImpl{}
	ctx := context.Background()
	data := wshrpc.CommandFileCopyData{SrcUri: localTestURI(src), DestUri: localTestURI(dest)}
	if _, err := impl.RemoteFileCopyCommand(ctx, data); err == nil || !strings.Contains(err.Error(), "set overwrite flag") {
		t.Fatalf("expected overwrite-required error, got %v", err)
	}
	if got, _ := os.ReadFile(dest); string(got) != "old" {
		t.Fatalf("destination changed without overwrite: %q", got)
	}
	data.Opts = &wshrpc.FileCopyOpts{Overwrite: true}
	if _, err := impl.RemoteFileCopyCommand(ctx, data); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(dest); string(got) != "new contents" {
		t.Fatalf("destination = %q", got)
	}
	if runtime.GOOS != "windows" {
		if info, _ := os.Stat(dest); info.Mode().Perm() != 0600 {
			t.Fatalf("overwrite should keep destination mode 0600, got %v", info.Mode().Perm())
		}
	}
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), fsutil.TempFilePrefix) {
			t.Fatalf("temp file left behind: %s", entry.Name())
		}
	}
}

func TestRemoteFileCopyCommandCopiesDirectories(t *testing.T) {
	dir := t.TempDir()
	srcDir := filepath.Join(dir, "proj")
	if err := os.MkdirAll(filepath.Join(srcDir, "pkg"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "pkg", "a.go"), []byte("package pkg"), 0644); err != nil {
		t.Fatal(err)
	}
	destDir := filepath.Join(dir, "backup")
	if err := os.Mkdir(destDir, 0755); err != nil {
		t.Fatal(err)
	}
	impl := &ServerImpl{}
	ctx := context.Background()
	isDir, err := impl.RemoteFileCopyCommand(ctx, wshrpc.CommandFileCopyData{SrcUri: localTestURI(srcDir), DestUri: localTestURI(destDir)})
	if err != nil || !isDir {
		t.Fatalf("directory copy: %v, isDir=%v", err, isDir)
	}
	if got, _ := os.ReadFile(filepath.Join(destDir, "proj", "pkg", "a.go")); string(got) != "package pkg" {
		t.Fatalf("copied file = %q", got)
	}
	_, err = impl.RemoteFileCopyCommand(ctx, wshrpc.CommandFileCopyData{SrcUri: localTestURI(srcDir), DestUri: localTestURI(filepath.Join(srcDir, "pkg"))})
	if err == nil || !strings.Contains(err.Error(), "into itself") {
		t.Fatalf("expected copy-into-itself error, got %v", err)
	}
}

func TestRemoteWriteFileCommandKeepsSymlinkAndMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "real.txt")
	if err := os.WriteFile(target, []byte("old"), 0640); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.txt")
	if err := os.Symlink("real.txt", link); err != nil {
		t.Fatal(err)
	}
	impl := &ServerImpl{}
	err := impl.RemoteWriteFileCommand(context.Background(), wshrpc.FileData{
		Info:   &wshrpc.FileInfo{Path: link, Opts: &wshrpc.FileOpts{Truncate: true}},
		Data64: base64.StdEncoding.EncodeToString([]byte("saved")),
	})
	if err != nil {
		t.Fatal(err)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("symlink was replaced: %v", err)
	}
	if got, _ := os.ReadFile(target); string(got) != "saved" {
		t.Fatalf("target = %q", got)
	}
	if info, _ := os.Stat(target); info.Mode().Perm() != 0640 {
		t.Fatalf("mode = %v, want 0640", info.Mode().Perm())
	}
}

func TestRemoteFileDeleteCommandDoesNotFollowSymlinkedDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "project")
	if err := os.MkdirAll(target, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "keep.txt"), []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "proj-link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	impl := &ServerImpl{}
	if err := impl.RemoteFileDeleteCommand(context.Background(), wshrpc.CommandDeleteFileData{Path: link + "/", Recursive: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(link); !os.IsNotExist(err) {
		t.Fatalf("symlink should be removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(target, "keep.txt")); err != nil {
		t.Fatalf("symlink target contents were deleted: %v", err)
	}
	err := impl.RemoteFileDeleteCommand(context.Background(), wshrpc.CommandDeleteFileData{Path: target})
	if err == nil || !strings.Contains(err.Error(), "recursive flag must be set") {
		t.Fatalf("expected recursive-required error, got %v", err)
	}
}
