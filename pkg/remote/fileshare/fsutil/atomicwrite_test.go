// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type failingReader struct {
	data []byte
	sent bool
}

func (r *failingReader) Read(p []byte) (int, error) {
	if !r.sent {
		r.sent = true
		return copy(p, r.data), nil
	}
	return 0, errors.New("connection dropped")
}

func assertNoTempFiles(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), TempFilePrefix) {
			t.Fatalf("temp file left behind: %s", entry.Name())
		}
	}
}

func TestReplaceLocalFileKeepsOriginalWhenTransferFails(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "report.txt")
	if err := os.WriteFile(target, []byte("original contents"), 0640); err != nil {
		t.Fatal(err)
	}
	_, err := ReplaceLocalFile(target, &failingReader{data: []byte("partial")}, ReplaceOpts{ExpectedSize: -1})
	if err == nil {
		t.Fatal("expected copy error")
	}
	got, err := os.ReadFile(target)
	if err != nil || string(got) != "original contents" {
		t.Fatalf("original was modified: %q, %v", got, err)
	}
	assertNoTempFiles(t, dir)
}

func TestReplaceLocalFileRejectsShortTransfer(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "report.txt")
	if err := os.WriteFile(target, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := ReplaceLocalFile(target, strings.NewReader("abc"), ReplaceOpts{ExpectedSize: 10})
	if err == nil || !strings.Contains(err.Error(), "incomplete transfer") {
		t.Fatalf("expected incomplete transfer error, got %v", err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "original" {
		t.Fatalf("original was modified: %q", got)
	}
	assertNoTempFiles(t, dir)
}

func TestReplaceLocalFilePreservesExistingMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix permissions")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "script.sh")
	if err := os.WriteFile(target, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(target, 0750); err != nil {
		t.Fatal(err)
	}
	n, err := ReplaceLocalFile(target, strings.NewReader("new contents"), ReplaceOpts{CreateMode: 0600, ExpectedSize: 12})
	if err != nil || n != 12 {
		t.Fatalf("replace: %d, %v", n, err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0750 {
		t.Fatalf("mode = %v, want 0750", info.Mode().Perm())
	}
	got, _ := os.ReadFile(target)
	if string(got) != "new contents" {
		t.Fatalf("contents = %q", got)
	}
	assertNoTempFiles(t, dir)
}

func TestSaveLocalFileWritesThroughSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	dir := t.TempDir()
	realDir := filepath.Join(dir, "real")
	if err := os.Mkdir(realDir, 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(realDir, "config.yml")
	if err := os.WriteFile(target, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "config-link.yml")
	if err := os.Symlink("real/config.yml", link); err != nil {
		t.Fatal(err)
	}
	if err := SaveLocalFile(link, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	linkInfo, err := os.Lstat(link)
	if err != nil || linkInfo.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("symlink was replaced: %v, %v", linkInfo, err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "new" {
		t.Fatalf("target contents = %q", got)
	}
	info, _ := os.Stat(target)
	if info.Mode().Perm() != 0600 {
		t.Fatalf("target mode = %v, want 0600", info.Mode().Perm())
	}
	assertNoTempFiles(t, realDir)
	assertNoTempFiles(t, dir)
}

func TestSaveLocalFileFallsBackInPlaceForReadOnlyDir(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs unix permissions as a non-root user")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(target, []byte("old contents"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0755) })
	if err := SaveLocalFile(target, []byte("new"), 0644); err != nil {
		t.Fatalf("save in read-only dir: %v", err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "new" {
		t.Fatalf("contents = %q", got)
	}
}

func TestSaveLocalFileRefusesReadOnlyFile(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs unix permissions as a non-root user")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "locked.txt")
	if err := os.WriteFile(target, []byte("locked"), 0444); err != nil {
		t.Fatal(err)
	}
	if err := SaveLocalFile(target, []byte("new"), 0644); err == nil {
		t.Fatal("expected read-only file to be refused")
	}
	if got, _ := os.ReadFile(target); string(got) != "locked" {
		t.Fatalf("read-only file changed: %q", got)
	}
}

func TestSaveLocalFileCreatesNewFile(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "new.txt")
	if err := SaveLocalFile(target, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "hello" {
		t.Fatalf("contents = %q", got)
	}
	if err := SaveLocalFile(filepath.Join(dir, "missing", "x.txt"), []byte("x"), 0644); err == nil {
		t.Fatal("expected error writing into a missing directory")
	}
	assertNoTempFiles(t, dir)
}
