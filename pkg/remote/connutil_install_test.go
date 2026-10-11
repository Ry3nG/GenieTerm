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
		"tempGlob":    shellutil.HardQuote("genie.temp*"),
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
	legacy := filepath.Join(dir, "genie.temp")
	fresh := filepath.Join(dir, "genie.temp.2")
	os.WriteFile(stale, []byte("old"), 0o644)
	os.WriteFile(legacy, []byte("old"), 0o644)
	os.WriteFile(fresh, []byte("in progress"), 0o644)
	old := time.Now().Add(-2 * time.Hour)
	os.Chtimes(stale, old, old)
	os.Chtimes(legacy, old, old)

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
	for _, f := range []string{stale, legacy} {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Fatalf("stale temp file %s was not pruned", filepath.Base(f))
		}
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

func TestProgressReaderReportsUncompressedBytes(t *testing.T) {
	data := strings.Repeat("x", 10000)
	var lastSent, lastTotal int64
	calls := 0
	pr := &progressReader{r: strings.NewReader(data), total: int64(len(data)), onProgress: func(sent, total int64) {
		calls++
		lastSent, lastTotal = sent, total
	}}
	buf := make([]byte, 1024)
	for {
		_, err := pr.Read(buf)
		if err != nil {
			break
		}
	}
	if calls == 0 || lastSent != int64(len(data)) || lastTotal != int64(len(data)) {
		t.Fatalf("calls=%d sent=%d total=%d", calls, lastSent, lastTotal)
	}
	if calls > 3 {
		t.Fatalf("progress should be throttled, got %d calls for a fast copy", calls)
	}
}
