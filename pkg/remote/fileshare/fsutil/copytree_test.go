// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeTestFile(t *testing.T, p string, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(contents), 0644); err != nil {
		t.Fatal(err)
	}
}

func readTestFile(t *testing.T, p string) string {
	t.Helper()
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return string(data)
}

func copyLocalTree(t *testing.T, srcPath string, destPath string, opts CopyOpts) error {
	t.Helper()
	return copyLocalTreeWithSource(t, LocalCopySource{}, srcPath, destPath, opts)
}

func copyLocalTreeWithSource(t *testing.T, src CopySource, srcPath string, destPath string, opts CopyOpts) error {
	t.Helper()
	entry, err := src.Stat(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	dest := LocalCopyDest{}
	finalPath, err := ResolveCopyDestPath(dest, destPath, filepath.Base(srcPath), false)
	if err != nil {
		t.Fatal(err)
	}
	return CopyTree(context.Background(), src, entry, dest, finalPath, opts)
}

func makeSourceTree(t *testing.T, root string) string {
	t.Helper()
	src := filepath.Join(root, "src", "proj")
	writeTestFile(t, filepath.Join(src, "a.txt"), "new a")
	writeTestFile(t, filepath.Join(src, "nested", "b.txt"), "new b")
	if err := os.Mkdir(filepath.Join(src, "empty"), 0755); err != nil {
		t.Fatal(err)
	}
	return src
}

func makeExistingDest(t *testing.T, root string) string {
	t.Helper()
	destDir := filepath.Join(root, "dest")
	writeTestFile(t, filepath.Join(destDir, "proj", "a.txt"), "old a")
	writeTestFile(t, filepath.Join(destDir, "proj", "keep.txt"), "keep")
	return destDir
}

func TestCopyTreeCopiesNewDirectory(t *testing.T) {
	root := t.TempDir()
	src := makeSourceTree(t, root)
	destDir := filepath.Join(root, "dest")
	if err := os.Mkdir(destDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := copyLocalTree(t, src, destDir, CopyOpts{}); err != nil {
		t.Fatal(err)
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "nested", "b.txt")); got != "new b" {
		t.Fatalf("nested file = %q", got)
	}
	if info, err := os.Stat(filepath.Join(destDir, "proj", "empty")); err != nil || !info.IsDir() {
		t.Fatalf("empty dir not copied: %v", err)
	}
	assertNoTempFiles(t, destDir)
}

func TestCopyTreeExistingDirectoryRequiresMergeOrOverwrite(t *testing.T) {
	root := t.TempDir()
	src := makeSourceTree(t, root)
	destDir := makeExistingDest(t, root)
	err := copyLocalTree(t, src, destDir, CopyOpts{})
	if err == nil || !strings.Contains(err.Error(), "set merge flag") {
		t.Fatalf("expected merge-required error, got %v", err)
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "a.txt")); got != "old a" {
		t.Fatalf("existing file modified: %q", got)
	}
}

func TestCopyTreeMergeReplacesFilesAndKeepsExtras(t *testing.T) {
	root := t.TempDir()
	src := makeSourceTree(t, root)
	destDir := makeExistingDest(t, root)
	if err := copyLocalTree(t, src, destDir, CopyOpts{Merge: true}); err != nil {
		t.Fatal(err)
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "a.txt")); got != "new a" {
		t.Fatalf("merged file = %q", got)
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "keep.txt")); got != "keep" {
		t.Fatalf("extra file = %q", got)
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "nested", "b.txt")); got != "new b" {
		t.Fatalf("nested file = %q", got)
	}
	assertNoTempFiles(t, filepath.Join(destDir, "proj"))
}

func TestCopyTreeOverwriteReplacesDirectory(t *testing.T) {
	root := t.TempDir()
	src := makeSourceTree(t, root)
	destDir := makeExistingDest(t, root)
	if err := copyLocalTree(t, src, destDir, CopyOpts{Overwrite: true}); err != nil {
		t.Fatal(err)
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "a.txt")); got != "new a" {
		t.Fatalf("replaced file = %q", got)
	}
	if _, err := os.Stat(filepath.Join(destDir, "proj", "keep.txt")); !os.IsNotExist(err) {
		t.Fatalf("overwrite should replace the directory, keep.txt: %v", err)
	}
	assertNoTempFiles(t, destDir)
}

type flakySource struct {
	LocalCopySource
	failName string
}

func (s flakySource) Open(p string) (io.ReadCloser, error) {
	if filepath.Base(p) == s.failName {
		return nil, fmt.Errorf("connection dropped")
	}
	return s.LocalCopySource.Open(p)
}

func TestCopyTreeOverwriteFailureKeepsExistingDirectory(t *testing.T) {
	root := t.TempDir()
	src := makeSourceTree(t, root)
	destDir := makeExistingDest(t, root)
	err := copyLocalTreeWithSource(t, flakySource{failName: "b.txt"}, src, destDir, CopyOpts{Overwrite: true})
	if err == nil {
		t.Fatal("expected copy error")
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "a.txt")); got != "old a" {
		t.Fatalf("existing file modified: %q", got)
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "keep.txt")); got != "keep" {
		t.Fatalf("existing file removed: %q", got)
	}
	assertNoTempFiles(t, destDir)
}

func TestCopyTreeFileRequiresOverwrite(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "src", "a.txt")
	writeTestFile(t, src, "new")
	dest := filepath.Join(root, "dest", "a.txt")
	writeTestFile(t, dest, "old")
	err := copyLocalTree(t, src, dest, CopyOpts{})
	if err == nil || !strings.Contains(err.Error(), "set overwrite flag") {
		t.Fatalf("expected overwrite-required error, got %v", err)
	}
	if err := copyLocalTree(t, src, dest, CopyOpts{Overwrite: true}); err != nil {
		t.Fatal(err)
	}
	if got := readTestFile(t, dest); got != "new" {
		t.Fatalf("dest = %q", got)
	}
}

func TestCopyTreeSkipsSymlinkedDirectories(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on windows")
	}
	root := t.TempDir()
	src := makeSourceTree(t, root)
	outside := filepath.Join(root, "outside")
	writeTestFile(t, filepath.Join(outside, "secret.txt"), "secret")
	if err := os.Symlink(outside, filepath.Join(src, "dirlink")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("a.txt", filepath.Join(src, "filelink.txt")); err != nil {
		t.Fatal(err)
	}
	destDir := filepath.Join(root, "dest")
	if err := os.Mkdir(destDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := copyLocalTree(t, src, destDir, CopyOpts{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(destDir, "proj", "dirlink")); !os.IsNotExist(err) {
		t.Fatalf("symlinked directory should be skipped: %v", err)
	}
	if got := readTestFile(t, filepath.Join(destDir, "proj", "filelink.txt")); got != "new a" {
		t.Fatalf("symlinked file contents = %q", got)
	}
}

func TestIsPathWithin(t *testing.T) {
	cases := []struct {
		parent string
		child  string
		want   bool
	}{
		{"/a/b", "/a/b", true},
		{"/a/b", "/a/b/c", true},
		{"/a/b", "/a/bc", false},
		{"/", "/x", true},
		{"/a/b", "/a", false},
	}
	for _, tc := range cases {
		if got := IsPathWithin(tc.parent, tc.child, "/"); got != tc.want {
			t.Fatalf("IsPathWithin(%q, %q) = %v, want %v", tc.parent, tc.child, got, tc.want)
		}
	}
}
