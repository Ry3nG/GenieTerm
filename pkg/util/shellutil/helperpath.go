// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf16"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
)

func windowsPathTooLong(path string) bool {
	return len(utf16.Encode([]rune(path))) >= 260
}

func getLocalHelperBinDir(dataHome string) (string, error) {
	binDir := filepath.Join(dataHome, WaveHomeBinDir)
	if runtime.GOOS != "windows" || !windowsPathTooLong(filepath.Join(binDir, "genie.exe")) {
		return binDir, nil
	}
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("resolve short helper cache directory: %w", err)
	}
	profileHash := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(dataHome))))
	binDir = filepath.Join(cacheDir, "GenieTerm", "helpers", fmt.Sprintf("%s-%s-%x", wavebase.WaveVersion, runtime.GOARCH, profileHash[:8]))
	// PowerShell cannot launch an executable beyond MAX_PATH, even with a device
	// namespace prefix. Keep aliases in a per-user/profile/version cache instead.
	if !filepath.IsAbs(binDir) || windowsPathTooLong(filepath.Join(binDir, "genie.exe")) {
		return "", fmt.Errorf("helper cache path exceeds the Windows executable path limit: %s", binDir)
	}
	return binDir, nil
}

func localPowerShellScriptPath(path string) string {
	if runtime.GOOS != "windows" || !windowsPathTooLong(path) || strings.HasPrefix(path, `\\?\`) {
		return path
	}
	if strings.HasPrefix(path, `\\`) {
		return `\\?\UNC\` + strings.TrimPrefix(path, `\\`)
	}
	return `\\?\` + path
}
