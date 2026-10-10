// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetDarwinProcPathMatchesExecutable(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	path, err := getDarwinProcPath(int32(os.Getpid()))
	if err != nil {
		t.Fatalf("getDarwinProcPath: %v", err)
	}
	wantPath, _ := filepath.EvalSymlinks(exe)
	gotPath, _ := filepath.EvalSymlinks(path)
	if gotPath != wantPath {
		t.Fatalf("path = %q, want %q", gotPath, wantPath)
	}
}

func TestExpandDarwinCommandKeepsShortNames(t *testing.T) {
	if got := expandDarwinCommand(int32(os.Getpid()), "zsh"); got != "zsh" {
		t.Fatalf("expandDarwinCommand short name = %q, want zsh", got)
	}
}

func TestExpandDarwinCommandIgnoresUnrelatedPath(t *testing.T) {
	comm := "not-this-binary-xy"
	if got := expandDarwinCommand(int32(os.Getpid()), comm); got != comm {
		t.Fatalf("expandDarwinCommand = %q, want %q", got, comm)
	}
}
