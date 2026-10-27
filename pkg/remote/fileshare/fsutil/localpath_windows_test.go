// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestWindowsLocalPathWithinCaseAndJunction(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "MixedCaseParent")
	target := filepath.Join(parent, "child")
	if err := os.MkdirAll(target, 0700); err != nil {
		t.Fatal(err)
	}
	upperParent := strings.ToUpper(parent)
	a, err := os.Stat(upperParent)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.Stat(parent)
	if err != nil || !os.SameFile(a, b) {
		t.Fatalf("fixture parent does not resolve to the same directory: %v", err)
	}
	for _, child := range []string{target, filepath.Join(target, "missing", "nested")} {
		if within, err := IsLocalPathWithin(upperParent, child); err != nil || !within {
			t.Fatalf("different casing bypassed containment: %v, %v", within, err)
		}
	}
	junction := filepath.Join(root, "outside-junction")
	cmd := exec.Command("cmd.exe", "/c", "mklink", "/J", junction, target)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("create owned test junction: %v: %s", err, out)
	}
	if within, err := IsLocalPathWithin(parent, filepath.Join(junction, "missing")); err != nil || !within {
		t.Fatalf("junction bypassed containment: %v, %v", within, err)
	}
}

func TestWindowsLocalPathWithinCaseSensitiveDirectories(t *testing.T) {
	root := t.TempDir()
	path, err := windows.UTF16PtrFromString(root)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(path, windows.FILE_WRITE_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	flags := uint32(windows.FILE_CS_FLAG_CASE_SENSITIVE_DIR)
	if err := windows.SetFileInformationByHandle(handle, windows.FileCaseSensitiveInfo, (*byte)(unsafe.Pointer(&flags)), 4); err != nil {
		t.Skipf("per-directory case sensitivity unavailable to this user/volume: %v", err)
	}
	parent, sibling := filepath.Join(root, "Parent"), filepath.Join(root, "parent")
	if err := os.Mkdir(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(sibling, 0700); err != nil {
		t.Fatal(err)
	}
	if within, err := IsLocalPathWithin(parent, filepath.Join(sibling, "missing")); err != nil || within {
		t.Fatalf("distinct case-sensitive directory treated as source: %v, %v", within, err)
	}
}
