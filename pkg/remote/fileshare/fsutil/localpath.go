// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"errors"
	"os"
	"path/filepath"
)

// IsLocalPathWithin compares filesystem identities so case-sensitive directories,
// junctions and alternate spellings cannot bypass the copy-into-itself guard.
// A missing destination inherits the relationship of its nearest existing ancestor.
func IsLocalPathWithin(parent, child string) (bool, error) {
	parentInfo, err := os.Stat(parent)
	if err != nil {
		return false, err
	}
	current, err := filepath.Abs(child)
	if err != nil {
		return false, err
	}
	for {
		_, err := os.Stat(current)
		if err == nil {
			break
		}
		if !errors.Is(err, os.ErrNotExist) {
			return false, err
		}
		next := filepath.Dir(current)
		if next == current {
			return false, err
		}
		current = next
	}
	current, err = resolveLocalPath(current)
	if err != nil {
		return false, err
	}
	for {
		info, err := os.Stat(current)
		if err != nil {
			return false, err
		}
		if os.SameFile(parentInfo, info) {
			return true, nil
		}
		next := filepath.Dir(current)
		if next == current {
			return false, nil
		}
		current = next
	}
}
