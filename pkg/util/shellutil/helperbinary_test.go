// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
)

func TestGetLocalHelperBinaryPathsExposeGeniePrimaryAndWshAlias(t *testing.T) {
	oldAppPath := wavebase.AppPath_VarCache
	t.Cleanup(func() {
		wavebase.AppPath_VarCache = oldAppPath
	})
	wavebase.AppPath_VarCache = filepath.Join(t.TempDir(), "GenieTerm.app")

	geniePath, err := GetLocalGenieBinaryPath("0.4.0", "linux", "amd64")
	if err != nil {
		t.Fatalf("GetLocalGenieBinaryPath returned error: %v", err)
	}
	wshPath, err := GetLocalWshBinaryPath("0.4.0", "linux", "amd64")
	if err != nil {
		t.Fatalf("GetLocalWshBinaryPath returned error: %v", err)
	}

	if filepath.Base(geniePath) != "genie-0.4.0-linux.x64" {
		t.Fatalf("genie artifact basename = %q", filepath.Base(geniePath))
	}
	if filepath.Base(wshPath) != "wsh-0.4.0-linux.x64" {
		t.Fatalf("wsh artifact basename = %q", filepath.Base(wshPath))
	}
}

func TestInstallLocalHelperBinariesCopiesGeniePrimaryAndWshCompatibility(t *testing.T) {
	oldAppPath := wavebase.AppPath_VarCache
	t.Cleanup(func() {
		wavebase.AppPath_VarCache = oldAppPath
	})

	appPath := t.TempDir()
	wavebase.AppPath_VarCache = appPath
	appBinDir := filepath.Join(appPath, wavebase.AppPathBinDir)
	if err := os.MkdirAll(appBinDir, 0755); err != nil {
		t.Fatal(err)
	}

	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	genieArtifact, err := GetLocalGenieBinaryPath("test", runtime.GOOS, runtime.GOARCH)
	if err != nil {
		t.Fatalf("GetLocalGenieBinaryPath returned error: %v", err)
	}
	if err := os.WriteFile(genieArtifact, []byte("genie helper"), 0755); err != nil {
		t.Fatal(err)
	}

	installDir := filepath.Join(t.TempDir(), "bin")
	if err := InstallLocalHelperBinaries(installDir, "test", runtime.GOOS, runtime.GOARCH); err != nil {
		t.Fatalf("InstallLocalHelperBinaries returned error: %v", err)
	}

	for _, name := range []string{"genie" + ext, "wsh" + ext} {
		content, err := os.ReadFile(filepath.Join(installDir, name))
		if err != nil {
			t.Fatalf("expected installed %s: %v", name, err)
		}
		if string(content) != "genie helper" {
			t.Fatalf("%s content = %q", name, string(content))
		}
	}
}
