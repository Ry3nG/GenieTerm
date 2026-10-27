// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func GetFileOwner(os.FileInfo) (FileOwner, bool) {
	return FileOwner{}, false
}

func localWindowsPath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(absolute, `\\?\`) {
		if strings.HasPrefix(absolute, `\\`) {
			absolute = `\\?\UNC\` + absolute[2:]
		} else {
			absolute = `\\?\` + absolute
		}
	}
	return absolute, nil
}

func openLocalAttributes(path string) (windows.Handle, error) {
	absolute, err := localWindowsPath(path)
	if err != nil {
		return 0, err
	}
	name, err := windows.UTF16PtrFromString(absolute)
	if err != nil {
		return 0, err
	}
	return windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
}

func localFileLinkCount(path string, _ os.FileInfo) (uint64, error) {
	handle, err := openLocalAttributes(path)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(handle)
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return 0, err
	}
	return uint64(info.NumberOfLinks), nil
}
