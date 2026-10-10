// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"compress/gzip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/util/shellutil"
)

func renderInstallScript(t *testing.T, dir string) (string, string) {
	t.Helper()
	installPath := filepath.Join(dir, "genie")
	var script bytes.Buffer
	err := installTemplate.Execute(&script, map[string]string{
		"installDir":  shellutil.HardQuote(dir),
		"tempPath":    shellutil.HardQuote(installPath + ".temp.123"),
		"installPath": shellutil.HardQuote(installPath),
		"tempGlob":    shellutil.HardQuote("genie.temp.*"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return script.String(), installPath
}

func runInstallScript(t *testing.T, script string, stdin []byte) error {
	t.Helper()
	cmd := exec.Command("sh", "-c", script)
	cmd.Stdin = bytes.NewReader(stdin)
	return cmd.Run()
}

func gzipBytes(t *testing.T, data string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write([]byte(data))
	zw.Close()
	return buf.Bytes()
}

func TestInstallScriptInstallsAndPrunesStaleTempFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("install script runs on the remote unix host")
	}
	dir := t.TempDir()
	stale := filepath.Join(dir, "genie.temp.1")
	fresh := filepath.Join(dir, "genie.temp.2")
	os.WriteFile(stale, []byte("old"), 0o644)
	os.WriteFile(fresh, []byte("in progress"), 0o644)
	old := time.Now().Add(-2 * time.Hour)
	os.Chtimes(stale, old, old)

	script, installPath := renderInstallScript(t, dir)
	if err := runInstallScript(t, script, gzipBytes(t, "helper-binary")); err != nil {
		t.Fatalf("install failed: %v", err)
	}
	got, err := os.ReadFile(installPath)
	if err != nil || string(got) != "helper-binary" {
		t.Fatalf("installed %q, err %v", got, err)
	}
	if info, _ := os.Stat(installPath); info.Mode()&0o111 == 0 {
		t.Fatal("helper is not executable")
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatal("stale temp file was not pruned")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatal("a concurrent install's fresh temp file was removed")
	}
	if _, err := os.Stat(installPath + ".temp.123"); !os.IsNotExist(err) {
		t.Fatal("this install's temp file was left behind")
	}
}

func TestInstallScriptRemovesTempFileWhenCopyFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("install script runs on the remote unix host")
	}
	dir := t.TempDir()
	script, installPath := renderInstallScript(t, dir)
	if err := runInstallScript(t, script, []byte("not gzip data")); err == nil {
		t.Fatal("expected the install to fail on corrupt input")
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.Contains(e.Name(), ".temp.") {
			t.Fatalf("temp file %s left after a failed copy", e.Name())
		}
	}
	if _, err := os.Stat(installPath); !os.IsNotExist(err) {
		t.Fatal("a failed copy must not install anything")
	}
}
