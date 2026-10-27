// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package fsutil

import "path/filepath"

func resolveLocalPath(path string) (string, error) {
	return filepath.EvalSymlinks(path)
}
