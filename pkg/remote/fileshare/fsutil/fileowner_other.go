// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !unix && !windows

package fsutil

import "os"

func GetFileOwner(info os.FileInfo) (FileOwner, bool) {
	return FileOwner{}, false
}

func localFileLinkCount(string, os.FileInfo) (uint64, error) {
	return 1, nil
}
