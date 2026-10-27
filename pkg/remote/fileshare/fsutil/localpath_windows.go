// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"fmt"

	"golang.org/x/sys/windows"
)

func resolveLocalPath(path string) (string, error) {
	handle, err := openLocalAttributes(path)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	buffer := make([]uint16, 260)
	for len(buffer) <= 32768 {
		size, err := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
		if err != nil {
			return "", err
		}
		if size < uint32(len(buffer)) {
			return windows.UTF16ToString(buffer[:size]), nil
		}
		if size >= 32768 {
			break
		}
		buffer = make([]uint16, size+1)
	}
	return "", fmt.Errorf("resolved Windows path exceeds maximum length")
}
