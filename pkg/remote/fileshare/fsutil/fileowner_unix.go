// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package fsutil

import (
	"os"
	"syscall"
)

func GetFileOwner(info os.FileInfo) (FileOwner, bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st == nil {
		return FileOwner{}, false
	}
	return FileOwner{Uid: int(st.Uid), Gid: int(st.Gid), Nlink: uint64(st.Nlink)}, true
}

func localFileLinkCount(_ string, info os.FileInfo) (uint64, error) {
	owner, _ := GetFileOwner(info)
	return owner.Nlink, nil
}
