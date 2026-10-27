// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var replaceWindowsFile = windows.NewLazySystemDLL("kernel32.dll").NewProc("ReplaceFileW")

func createLocalReplacement(tempPath, target string, mode os.FileMode, targetExists bool) (*os.File, error) {
	if !targetExists {
		return os.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	}
	targetPath, err := localWindowsPath(target)
	if err != nil {
		return nil, err
	}
	descriptor, err := windows.GetNamedSecurityInfo(targetPath, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return nil, err
	}
	// Prevent broader parent-directory ACEs from being inherited at creation.
	// Tightening an initially permissive DACL would not revoke already-open handles.
	if err := descriptor.SetControl(windows.SE_DACL_PROTECTED, windows.SE_DACL_PROTECTED); err != nil {
		return nil, err
	}
	stagingPath, err := localWindowsPath(tempPath)
	if err != nil {
		return nil, err
	}
	name, err := windows.UTF16PtrFromString(stagingPath)
	if err != nil {
		return nil, err
	}
	security := windows.SecurityAttributes{SecurityDescriptor: descriptor}
	security.Length = uint32(unsafe.Sizeof(security))
	attrs := uint32(windows.FILE_ATTRIBUTE_NORMAL)
	if mode&0200 == 0 {
		attrs = windows.FILE_ATTRIBUTE_READONLY
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, &security, windows.CREATE_NEW, attrs, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(handle), tempPath), nil
}

func prepareLocalReplacement(target, tempPath string) error {
	targetPath, err := localWindowsPath(target)
	if err != nil {
		return err
	}
	stagingPath, err := localWindowsPath(tempPath)
	if err != nil {
		return err
	}
	descriptor, err := windows.GetNamedSecurityInfo(targetPath, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	control, _, err := descriptor.Control()
	if err != nil {
		return err
	}
	flags := windows.DACL_SECURITY_INFORMATION | windows.UNPROTECTED_DACL_SECURITY_INFORMATION
	if control&windows.SE_DACL_PROTECTED != 0 {
		flags = windows.DACL_SECURITY_INFORMATION | windows.PROTECTED_DACL_SECURITY_INFORMATION
	}
	// Protect private contents before streaming them into the temporary file;
	// ReplaceFile merges the final metadata only after the write completes.
	return windows.SetNamedSecurityInfo(stagingPath, windows.SE_FILE_OBJECT, windows.SECURITY_INFORMATION(flags), nil, nil, dacl, nil)
}

func commitLocalReplacement(tempPath, target string, targetExists bool) error {
	if !targetExists {
		var names [2]*uint16
		for i, path := range []string{tempPath, target} {
			absolute, err := localWindowsPath(path)
			if err != nil {
				return err
			}
			names[i], err = windows.UTF16PtrFromString(absolute)
			if err != nil {
				return err
			}
		}
		return windows.MoveFileEx(names[0], names[1], 0)
	}
	backupName, err := MakeTempName(filepath.Base(target))
	if err != nil {
		return err
	}
	backup := filepath.Join(filepath.Dir(target), backupName)
	var names [3]*uint16
	for i, path := range []string{target, tempPath, backup} {
		absolute, err := localWindowsPath(path)
		if err != nil {
			return err
		}
		names[i], err = windows.UTF16PtrFromString(absolute)
		if err != nil {
			return err
		}
	}
	// ReplaceFile preserves the existing DACL and streams. A backup prevents
	// ERROR_UNABLE_TO_MOVE_REPLACEMENT from deleting the only original copy.
	// Flags remain zero: ACL/metadata merge failures must never be ignored.
	ok, _, callErr := replaceWindowsFile.Call(uintptr(unsafe.Pointer(names[0])), uintptr(unsafe.Pointer(names[1])), uintptr(unsafe.Pointer(names[2])), 0, 0, 0)
	if ok == 0 {
		return recoverWindowsReplacement(target, backup, callErr)
	}
	if err := os.Remove(backup); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("save: replaced %q but cannot remove previous contents at %q: %v", target, backup, err)
	}
	return nil
}

func recoverWindowsReplacement(target, backup string, cause error) error {
	if _, err := os.Stat(backup); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("%w; cannot inspect original backup at %q: %v", cause, backup, err)
		}
		return cause
	}
	if _, err := os.Stat(target); errors.Is(err, os.ErrNotExist) {
		if restoreErr := commitLocalReplacement(backup, target, false); restoreErr == nil {
			return cause
		} else {
			return fmt.Errorf("%w; original file retained at %q (restore failed: %v)", cause, backup, restoreErr)
		}
	}
	return fmt.Errorf("%w; original file retained at %q", cause, backup)
}
