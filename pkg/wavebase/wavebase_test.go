// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavebase

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

func TestRemoteRuntimePathsUseGenieTerm(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	if RemoteFullDomainSocketPath != "~/.genieterm/genie-remote.sock" {
		t.Fatalf("unexpected remote domain socket path: %q", RemoteFullDomainSocketPath)
	}

	persistentSock := GetPersistentRemoteSockName("client-test")
	if persistentSock != "~/.genieterm/client/client-test/genieterm.sock" {
		t.Fatalf("unexpected persistent remote socket path: %q", persistentSock)
	}

	jobLogDir := GetRemoteJobLogDir()
	if jobLogDir != filepath.Join(homeDir, ".genieterm", "jobs") {
		t.Fatalf("unexpected remote job log dir: %q", jobLogDir)
	}

	jobSock := GetRemoteJobSocketPath("job-test")
	if !strings.Contains(jobSock, string(filepath.Separator)+"genieterm-") {
		t.Fatalf("job socket should use genieterm temp prefix: %q", jobSock)
	}

	legacyJobSock := GetLegacyRemoteJobSocketPath("job-test")
	if !strings.Contains(legacyJobSock, string(filepath.Separator)+"waveterm-") {
		t.Fatalf("legacy job socket should keep waveterm temp prefix: %q", legacyJobSock)
	}
}
