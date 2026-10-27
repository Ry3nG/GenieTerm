// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLocalPathWithin(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "parent")
	if err := os.MkdirAll(filepath.Join(parent, "child"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path string
		want bool
	}{
		{parent, true},
		{filepath.Join(parent, "child"), true},
		{filepath.Join(parent, "child", "missing", "nested"), true},
		{root, false},
		{filepath.Join(root, "parent-sibling", "missing"), false},
	} {
		got, err := IsLocalPathWithin(parent, tc.path)
		if err != nil || got != tc.want {
			t.Fatalf("path %q within=%v want=%v err=%v", tc.path, got, tc.want, err)
		}
	}
}

func TestSaveLocalFilePreservesHardlinks(t *testing.T) {
	dir := t.TempDir()
	file, alias := filepath.Join(dir, "file.txt"), filepath.Join(dir, "alias.txt")
	if err := os.WriteFile(file, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(file, alias); err != nil {
		t.Fatal(err)
	}
	if err := SaveLocalFile(file, []byte("after"), 0600); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(alias)
	if err != nil || string(data) != "after" {
		t.Fatalf("hard-link contents = %q, err=%v", data, err)
	}
	a, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.Stat(alias)
	if err != nil || !os.SameFile(a, b) {
		t.Fatalf("save detached the hard-link identity: %v", err)
	}
	assertNoTempFiles(t, dir)
}
