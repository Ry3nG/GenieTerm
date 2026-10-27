// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func protectTestFile(t *testing.T, path string) string {
	t.Helper()
	return setTestFileDACL(t, path, true)
}

func setTestFileDACL(t *testing.T, path string, protected bool) string {
	t.Helper()
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		t.Fatal(err)
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	absolute, err := localWindowsPath(path)
	if err != nil {
		t.Fatal(err)
	}
	flags := windows.DACL_SECURITY_INFORMATION | windows.UNPROTECTED_DACL_SECURITY_INFORMATION
	if protected {
		flags = windows.DACL_SECURITY_INFORMATION | windows.PROTECTED_DACL_SECURITY_INFORMATION
	}
	if err := windows.SetNamedSecurityInfo(absolute, windows.SE_FILE_OBJECT, windows.SECURITY_INFORMATION(flags), nil, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
	return testFileDACL(t, path)
}

func testFileDACL(t *testing.T, path string) string {
	t.Helper()
	absolute, err := localWindowsPath(path)
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.GetNamedSecurityInfo(absolute, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	return sd.String()
}

func TestWindowsSavePreservesDACLAndStreams(t *testing.T) {
	for _, long := range []bool{false, true} {
		t.Run(map[bool]string{false: "normal", true: "long-unicode"}[long], func(t *testing.T) {
			dir := t.TempDir()
			if long {
				for len(dir) < 350 {
					dir = filepath.Join(dir, "用户 O'Brien long directory")
				}
			}
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(dir, "private.txt")
			if err := os.WriteFile(file, []byte("before"), 0600); err != nil {
				t.Fatal(err)
			}
			before := protectTestFile(t, file)
			if err := os.WriteFile(file+":metadata", []byte("preserved stream"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := SaveLocalFile(file, []byte("after"), 0600); err != nil {
				t.Fatal(err)
			}
			if after := testFileDACL(t, file); after != before {
				t.Fatal("saving changed the protected user-only DACL")
			}
			data, err := os.ReadFile(file + ":metadata")
			if err != nil || string(data) != "preserved stream" {
				t.Fatalf("named stream = %q, err=%v", data, err)
			}
			data, err = os.ReadFile(file)
			if err != nil || string(data) != "after" {
				t.Fatalf("saved data = %q, err=%v", data, err)
			}
			assertNoTempFiles(t, dir)
		})
	}
}

func TestWindowsSaveSharingViolationPreservesOriginal(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "busy.txt")
	if err := os.WriteFile(file, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	before := protectTestFile(t, file)
	name, err := windows.UTF16PtrFromString(file)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	if err := SaveLocalFile(file, []byte("after"), 0600); !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("got %v, want sharing violation", err)
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != "before" || testFileDACL(t, file) != before {
		t.Fatalf("failed save changed original data or DACL: data=%q err=%v", data, err)
	}
	assertNoTempFiles(t, dir)
}

func TestWindowsSaveReadOnlyFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "readonly.txt")
	if err := os.WriteFile(file, []byte("before"), 0400); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(file, 0600)
	if err := SaveLocalFile(file, []byte("after"), 0600); err == nil {
		t.Fatal("saving read-only file succeeded")
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != "before" {
		t.Fatalf("read-only contents changed: %q, %v", data, err)
	}
}

func TestWindowsReplacementRecovery(t *testing.T) {
	dir := t.TempDir()
	file, backup := filepath.Join(dir, "original"), filepath.Join(dir, "backup")
	if err := os.WriteFile(backup, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	cause := windows.ERROR_UNABLE_TO_MOVE_REPLACEMENT_2
	if err := recoverWindowsReplacement(file, backup, cause); !errors.Is(err, cause) {
		t.Fatalf("replacement error lost: %v", err)
	}
	if data, _ := os.ReadFile(file); string(data) != "before" {
		t.Fatal("original backup was not restored")
	}
	if err := os.WriteFile(backup, []byte("backup"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := recoverWindowsReplacement(file, backup, cause); !errors.Is(err, cause) || !strings.Contains(err.Error(), strconv.Quote(backup)) {
		t.Fatalf("recoverable backup location lost: %v", err)
	}
	if data, _ := os.ReadFile(file); string(data) != "before" {
		t.Fatal("recovery overwrote existing target")
	}
}

func TestWindowsCreateDoesNotReplaceConcurrentTarget(t *testing.T) {
	dir := t.TempDir()
	file, staged := filepath.Join(dir, "new.txt"), filepath.Join(dir, "staged.txt")
	if err := os.WriteFile(staged, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := commitLocalReplacement(staged, file, false); err != nil {
		t.Fatal(err)
	}
	before := protectTestFile(t, file)
	if err := os.WriteFile(staged, []byte("racing writer"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := commitLocalReplacement(staged, file, false); err == nil {
		t.Fatal("create path replaced a target that appeared after the initial stat")
	}
	if data, _ := os.ReadFile(file); string(data) != "new" || testFileDACL(t, file) != before {
		t.Fatal("create conflict changed the existing data or DACL")
	}
}

type checkingFileReader struct {
	io.Reader
	check func()
}

func (r *checkingFileReader) Read(data []byte) (int, error) {
	if r.check != nil {
		r.check()
		r.check = nil
	}
	return r.Reader.Read(data)
}

func TestWindowsPrivateFileStagingKeepsDACL(t *testing.T) {
	for _, protected := range []bool{true, false} {
		t.Run(map[bool]string{true: "protected", false: "inherited"}[protected], func(t *testing.T) {
			testWindowsFileStagingDACL(t, protected)
		})
	}
}

func TestWindowsStagingCreatedWithPrivateDACL(t *testing.T) {
	dir := t.TempDir()
	target, staged := filepath.Join(dir, "private.txt"), filepath.Join(dir, "staged.txt")
	if err := os.WriteFile(target, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	before := protectTestFile(t, target)
	expected, err := windows.SecurityDescriptorFromString(before)
	if err != nil {
		t.Fatal(err)
	}
	// A newly created protected ACL has no inheritance history yet.
	if err := expected.SetControl(windows.SE_DACL_AUTO_INHERITED, 0); err != nil {
		t.Fatal(err)
	}
	file, err := createLocalReplacement(staged, target, 0600, true)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if created := testFileDACL(t, staged); created != expected.String() {
		t.Fatalf("initial staging DACL differs before preparation: original=%s staging=%s", before, created)
	}
	if _, err := createLocalReplacement(staged, target, 0600, true); !errors.Is(err, os.ErrExist) {
		t.Fatalf("staging creation must not replace an existing file: %v", err)
	}
}

func testWindowsFileStagingDACL(t *testing.T, protected bool) {
	t.Helper()
	dir := t.TempDir()
	file := filepath.Join(dir, "private.txt")
	if err := os.WriteFile(file, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	before := setTestFileDACL(t, file, protected)
	reader := &checkingFileReader{Reader: strings.NewReader("after"), check: func() {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), TempFilePrefix) {
				found = true
				if staged := testFileDACL(t, filepath.Join(dir, entry.Name())); staged != before {
					t.Fatalf("staging DACL differs before content transfer: original=%s staging=%s", before, staged)
				}
			}
		}
		if !found {
			t.Fatal("staging file not found before content transfer")
		}
	}}
	if _, err := ReplaceLocalFile(file, reader, ReplaceOpts{ExpectedSize: 5, StrictOwner: true}); err != nil {
		t.Fatal(err)
	}
	if after := testFileDACL(t, file); after != before {
		t.Fatalf("replacement DACL differs: original=%s replacement=%s", before, after)
	}
}
