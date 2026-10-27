// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package fsutil

import "os"

func createLocalReplacement(tempPath, _ string, mode os.FileMode, _ bool) (*os.File, error) {
	return os.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
}

func prepareLocalReplacement(string, string) error {
	return nil
}

func commitLocalReplacement(tempPath, target string, _ bool) error {
	return os.Rename(tempPath, target)
}
