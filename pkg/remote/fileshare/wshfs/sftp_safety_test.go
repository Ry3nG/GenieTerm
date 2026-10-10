// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs

import (
	"bytes"
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

func assertNoGenieTempFiles(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), fsutil.TempFilePrefix) {
			t.Fatalf("temp file left behind in %s: %s", dir, entry.Name())
		}
	}
}

func TestSFTPDeleteDoesNotFollowSymlinkedDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	host := makeSFTPTestConnection(t)
	ctx := context.Background()
	dir := t.TempDir()
	target := filepath.Join(dir, "project")
	if err := os.MkdirAll(filepath.Join(target, "src"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "src", "main.go"), []byte("package main"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "proj-link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := Delete(ctx, wshrpc.CommandDeleteFileData{Path: sftpTestRemoteURI(host, link), Recursive: true}); err != nil {
		t.Fatalf("recursive delete of symlink: %v", err)
	}
	if _, err := os.Lstat(link); !os.IsNotExist(err) {
		t.Fatalf("symlink should be removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(target, "src", "main.go")); err != nil {
		t.Fatalf("symlink target contents were deleted: %v", err)
	}

	err := Delete(ctx, wshrpc.CommandDeleteFileData{Path: sftpTestRemoteURI(host, target)})
	if err == nil || !strings.Contains(err.Error(), RecursiveRequiredError) {
		t.Fatalf("expected recursive-required error, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(target, "src", "main.go")); err != nil {
		t.Fatalf("non-recursive delete removed contents: %v", err)
	}

	empty := filepath.Join(dir, "empty")
	if err := os.Mkdir(empty, 0755); err != nil {
		t.Fatal(err)
	}
	if err := Delete(ctx, wshrpc.CommandDeleteFileData{Path: sftpTestRemoteURI(host, empty)}); err != nil {
		t.Fatalf("delete empty dir: %v", err)
	}

	innerLink := filepath.Join(target, "outside-link")
	outside := filepath.Join(dir, "outside")
	if err := os.Mkdir(outside, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "keep.txt"), []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, innerLink); err != nil {
		t.Fatal(err)
	}
	if err := Delete(ctx, wshrpc.CommandDeleteFileData{Path: sftpTestRemoteURI(host, target), Recursive: true}); err != nil {
		t.Fatalf("recursive delete: %v", err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("directory should be removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(outside, "keep.txt")); err != nil {
		t.Fatalf("nested symlink target was deleted: %v", err)
	}
}

func TestSFTPSaveWritesThroughSymlinkAndKeepsMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	host := makeSFTPTestConnection(t)
	ctx := context.Background()
	dir := t.TempDir()
	realDir := filepath.Join(dir, "dotfiles")
	if err := os.Mkdir(realDir, 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(realDir, "bashrc")
	if err := os.WriteFile(target, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, ".bashrc")
	if err := os.Symlink("dotfiles/bashrc", link); err != nil {
		t.Fatal(err)
	}
	err := PutFile(ctx, wshrpc.FileData{
		Info:   &wshrpc.FileInfo{Path: sftpTestRemoteURI(host, link)},
		Data64: base64.StdEncoding.EncodeToString([]byte("export EDITOR=vim\n")),
	})
	if err != nil {
		t.Fatal(err)
	}
	linkInfo, err := os.Lstat(link)
	if err != nil || linkInfo.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("symlink was replaced by a regular file: %v, %v", linkInfo, err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "export EDITOR=vim\n" {
		t.Fatalf("target contents = %q", got)
	}
	info, _ := os.Stat(target)
	if info.Mode().Perm() != 0600 {
		t.Fatalf("mode = %v, want 0600", info.Mode().Perm())
	}
	assertNoGenieTempFiles(t, dir)
	assertNoGenieTempFiles(t, realDir)
}

func TestSFTPSaveFallsBackInPlaceForReadOnlyDir(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs unix permissions as a non-root user")
	}
	host := makeSFTPTestConnection(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "shared.conf")
	if err := os.WriteFile(target, []byte("old contents"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0755) })
	err := PutFile(context.Background(), wshrpc.FileData{
		Info:   &wshrpc.FileInfo{Path: sftpTestRemoteURI(host, target)},
		Data64: base64.StdEncoding.EncodeToString([]byte("new")),
	})
	if err != nil {
		t.Fatalf("save in read-only dir: %v", err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "new" {
		t.Fatalf("contents = %q", got)
	}
}

func TestSFTPUploadsFoldersWithMergeAndOverwrite(t *testing.T) {
	host := makeSFTPTestConnection(t)
	ctx := context.Background()
	root := t.TempDir()
	localDir := filepath.Join(root, "local", "site")
	if err := os.MkdirAll(filepath.Join(localDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localDir, "index.html"), []byte("v1"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localDir, "assets", "app.js"), []byte("js"), 0644); err != nil {
		t.Fatal(err)
	}
	remoteDir := filepath.Join(root, "remote")
	if err := os.Mkdir(remoteDir, 0755); err != nil {
		t.Fatal(err)
	}
	copyData := wshrpc.CommandFileCopyData{SrcUri: sftpTestFileURI(localDir), DestUri: sftpTestRemoteURI(host, remoteDir)}
	if err := Copy(ctx, copyData); err != nil {
		t.Fatalf("folder upload: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(remoteDir, "site", "assets", "app.js"))
	if err != nil || string(got) != "js" {
		t.Fatalf("uploaded nested file: %q, %v", got, err)
	}

	if err := os.WriteFile(filepath.Join(localDir, "index.html"), []byte("v2"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(remoteDir, "site", "remote-only.txt"), []byte("remote"), 0644); err != nil {
		t.Fatal(err)
	}
	err = Copy(ctx, copyData)
	if err == nil || !strings.Contains(err.Error(), "set merge flag") {
		t.Fatalf("expected merge-required error, got %v", err)
	}
	mergeData := copyData
	mergeData.Opts = &wshrpc.FileCopyOpts{Merge: true}
	if err := Copy(ctx, mergeData); err != nil {
		t.Fatalf("merge upload: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(remoteDir, "site", "index.html")); string(got) != "v2" {
		t.Fatalf("merged file = %q", got)
	}
	if _, err := os.Stat(filepath.Join(remoteDir, "site", "remote-only.txt")); err != nil {
		t.Fatalf("merge removed remote-only file: %v", err)
	}
	overwriteData := copyData
	overwriteData.Opts = &wshrpc.FileCopyOpts{Overwrite: true}
	if err := Copy(ctx, overwriteData); err != nil {
		t.Fatalf("overwrite upload: %v", err)
	}
	if _, err := os.Stat(filepath.Join(remoteDir, "site", "remote-only.txt")); !os.IsNotExist(err) {
		t.Fatalf("overwrite should replace the folder: %v", err)
	}
	assertNoGenieTempFiles(t, remoteDir)

	selfCopy := wshrpc.CommandFileCopyData{SrcUri: sftpTestRemoteURI(host, filepath.Join(remoteDir, "site")), DestUri: sftpTestRemoteURI(host, filepath.Join(remoteDir, "site", "assets"))}
	if err := Copy(ctx, selfCopy); err == nil || !strings.Contains(err.Error(), "into itself") {
		t.Fatalf("expected copy-into-itself error, got %v", err)
	}
}

func TestSFTPUploadStreamsFilesLargerThanTransferLimit(t *testing.T) {
	host := makeSFTPTestConnection(t)
	root := t.TempDir()
	localPath := filepath.Join(root, "big.bin")
	want := bytes.Repeat([]byte("0123456789abcdef"), (RemoteFileTransferSizeLimit/16)+4096)
	if err := os.WriteFile(localPath, want, 0644); err != nil {
		t.Fatal(err)
	}
	remoteDir := filepath.Join(root, "remote")
	if err := os.Mkdir(remoteDir, 0755); err != nil {
		t.Fatal(err)
	}
	err := Copy(context.Background(), wshrpc.CommandFileCopyData{SrcUri: sftpTestFileURI(localPath), DestUri: sftpTestRemoteURI(host, remoteDir) + "/"})
	if err != nil {
		t.Fatalf("large upload: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(remoteDir, "big.bin"))
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("large upload returned %d of %d bytes: %v", len(got), len(want), err)
	}
}
