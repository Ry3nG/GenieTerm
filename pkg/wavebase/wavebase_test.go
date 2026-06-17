// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavebase

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveWaveCachesDirUsesGenieTermBundle(t *testing.T) {
	oldDevVarCache := Dev_VarCache
	t.Cleanup(func() {
		Dev_VarCache = oldDevVarCache
	})

	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("XDG_CACHE_HOME", filepath.Join(homeDir, "xdg-cache"))
	t.Setenv("LOCALAPPDATA", filepath.Join(homeDir, "local-app-data"))

	testCases := []struct {
		name      string
		devVar    string
		bundleDir string
	}{
		{name: "production", bundleDir: "genieterm"},
		{name: "development", devVar: "1", bundleDir: "genieterm-dev"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			Dev_VarCache = tc.devVar

			var expected string
			switch runtime.GOOS {
			case "darwin":
				expected = filepath.Join(homeDir, "Library", "Caches", tc.bundleDir)
			case "linux":
				expected = filepath.Join(homeDir, "xdg-cache", tc.bundleDir)
			case "windows":
				expected = filepath.Join(homeDir, "local-app-data", tc.bundleDir, "Cache")
			default:
				expected = filepath.Join(os.TempDir(), tc.bundleDir)
			}

			actual := resolveWaveCachesDir()
			if actual != expected {
				t.Fatalf("expected cache dir %q, got %q", expected, actual)
			}
		})
	}
}
