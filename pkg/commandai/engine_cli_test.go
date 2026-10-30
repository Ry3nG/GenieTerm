//go:build !windows

// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func fakePath(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old := resolvePath
	resolvePath = func(bool) string { return dir + string(os.PathListSeparator) + "/usr/bin:/bin" }
	t.Cleanup(func() { resolvePath = old })
	return dir
}

func fakeCLI(t *testing.T, dir, name, script string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\n"+script+"\n"), 0700); err != nil {
		t.Fatal(err)
	}
}

func TestCLIArgs(t *testing.T) {
	args := codexArgs("/tmp/work", "test-model")
	want := []string{"exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-rules", "-C", "/tmp/work", "-c", `model_reasoning_effort="low"`, "-c", "mcp_servers={}", "-c", "features.shell_tool=false", "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.browser_use=false", "-c", "features.computer_use=false", "--output-schema", "/tmp/work/schema.json", "-o", "/tmp/work/out.json", "-m", "test-model", "-"}
	if !reflect.DeepEqual(args, want) {
		t.Fatal(args)
	}
	args = claudeArgs("static system", "haiku")
	want = []string{"-p", "--restricted", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--system-prompt", "static system", "--output-format", "json", "--json-schema", responseSchema, "--model", "haiku"}
	if !reflect.DeepEqual(args, want) {
		t.Fatal(args)
	}
	if !strings.Contains(strings.Join(claudeArgs("system", ""), "|"), "--effort|low") {
		t.Fatal("missing effort")
	}
}

func TestFakeCLISuccess(t *testing.T) {
	for _, id := range []string{EngineCodex, EngineClaude} {
		t.Run(id, func(t *testing.T) {
			testConfig(t, id)
			dir := fakePath(t)
			capture := filepath.Join(dir, "stdin")
			cwdFile := filepath.Join(dir, "cwd")
			t.Setenv("TEST_INPUT", capture)
			t.Setenv("TEST_CWD", cwdFile)
			script := `for arg in "$@"; do case "$arg" in *PRIVATE_REQUEST*) exit 9;; esac; done
[ "$NO_COLOR" = 1 ] || exit 8
pwd > "$TEST_CWD"
cat > "$TEST_INPUT"
`
			if id == EngineCodex {
				script += `while [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then shift; out="$1"; fi; shift; done
printf '%s' '{"proposals":[{"command":"find . -type f -size +104857600c","explanation":"Find files ..."}]}' > "$out"`
			} else {
				script += `printf '%s' '{"type":"result","subtype":"success","is_error":false,"duration_ms":3676,"result":"","structured_output":{"proposals":[{"command":"find . -type f -size +100M -exec ls -lh {} + 2>/dev/null","explanation":"Lists files over 100 MB ..."}]}}'`
			}
			fakeCLI(t, dir, id, script)
			result := Run(context.Background(), wshrpc.CommandAiRequest{RequestId: "fake", Prompt: "PRIVATE_REQUEST", Context: wshrpc.CommandAiContext{Distro: "test"}})
			if result.Status != StatusOk || len(result.Proposals) != 1 || result.Engine != id || result.RequestId != "fake" {
				t.Fatalf("%+v", result)
			}
			input, err := os.ReadFile(capture)
			if err != nil || !strings.Contains(string(input), "PRIVATE_REQUEST") {
				t.Fatalf("stdin missing %v", err)
			}
			cwd, _ := os.ReadFile(cwdFile)
			if _, err := os.Stat(strings.TrimSpace(string(cwd))); !os.IsNotExist(err) {
				t.Fatalf("temp directory was not removed: %v", err)
			}
		})
	}
}

func TestFakeCLIFailures(t *testing.T) {
	for _, tt := range []struct{ name, id, script, status string }{
		{"codex auth", EngineCodex, `printf 'not logged in SECRET=private-value' >&2; exit 1`, StatusSignedOut},
		{"claude auth", EngineClaude, `printf '%s' '{"is_error":true,"result":"Invalid API key. /login"}'`, StatusSignedOut},
		{"claude oauth", EngineClaude, `printf 'OAuth expired' >&2; exit 1`, StatusSignedOut},
		{"nonzero", EngineCodex, `printf 'PRIVATE_REQUEST failed' >&2; exit 7`, StatusFailed},
		{"malformed", EngineClaude, `printf 'PRIVATE_REQUEST'`, StatusFailed},
		{"empty", EngineClaude, `printf '%s' '{"structured_output":{"summary":"","proposals":[]}}'`, StatusEmpty},
		{"summary only", EngineClaude, `printf '%s' '{"structured_output":{"summary":"Install the missing tool.","proposals":[]}}'`, StatusOk},
	} {
		t.Run(tt.name, func(t *testing.T) {
			testConfig(t, tt.id)
			dir := fakePath(t)
			fakeCLI(t, dir, tt.id, tt.script)
			r := Run(context.Background(), wshrpc.CommandAiRequest{Prompt: "PRIVATE_REQUEST"})
			if r.Status != tt.status || strings.Contains(r.StatusDetail, "PRIVATE_REQUEST") || strings.Contains(r.StatusDetail, "private-value") {
				t.Fatal(r)
			}
			if tt.status == StatusSignedOut && r.FixCommand != loginCommand(tt.id) {
				t.Fatal(r)
			}
		})
	}
	testConfig(t, EngineCodex)
	old := resolvePath
	resolvePath = func(bool) string { return t.TempDir() }
	defer func() { resolvePath = old }()
	if r := Run(context.Background(), wshrpc.CommandAiRequest{}); r.Status != StatusUnavailable || r.FixCommand != installCommand(EngineCodex) {
		t.Fatal(r)
	}
}

func waitFile(t *testing.T, path string) []byte {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil && len(data) > 0 {
			return data
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("fake CLI did not start")
	return nil
}

func TestCLICancelKillsProcessGroup(t *testing.T) {
	testConfig(t, EngineCodex)
	dir := fakePath(t)
	pidFile := filepath.Join(dir, "pid")
	childFile := filepath.Join(dir, "child")
	t.Setenv("TEST_PID", pidFile)
	t.Setenv("TEST_CHILD", childFile)
	fakeCLI(t, dir, EngineCodex, `sleep 60 &
printf '%s' "$!" > "$TEST_CHILD"
printf '%s' "$$" > "$TEST_PID"
wait`)
	done := make(chan wshrpc.CommandAiResult, 1)
	go func() { done <- Run(context.Background(), wshrpc.CommandAiRequest{RequestId: "cancel-tree"}) }()
	pid, _ := strconv.Atoi(string(waitFile(t, pidFile)))
	child, _ := strconv.Atoi(string(waitFile(t, childFile)))
	defer syscall.Kill(-pid, syscall.SIGKILL)
	Cancel("cancel-tree")
	select {
	case r := <-done:
		if r.Status != StatusCanceled {
			t.Fatal(r)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel hung")
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if syscall.Kill(-pid, 0) == syscall.ESRCH && syscall.Kill(child, 0) == syscall.ESRCH {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("process group %d or child %d survived", pid, child)
}

func TestCLITimeout(t *testing.T) {
	testConfig(t, EngineClaude)
	dir := fakePath(t)
	fakeCLI(t, dir, EngineClaude, `sleep 60`)
	old := cliTimeout
	cliTimeout = 40 * time.Millisecond
	defer func() { cliTimeout = old }()
	r := Run(context.Background(), wshrpc.CommandAiRequest{})
	if r.Status != StatusTimeout || r.StatusDetail != "Claude Code took too long to answer." {
		t.Fatal(r)
	}
}

func TestCappedProcessOutput(t *testing.T) {
	var b cappedBuffer
	input := strings.Repeat("x", processOutputLimit+20) + "tail"
	n, err := b.Write([]byte(input))
	if err != nil || n != len(input) || b.Len() != processOutputLimit || !strings.HasSuffix(b.String(), "tail") {
		t.Fatal("cap failed")
	}
	_, _ = b.Write([]byte("last"))
	if b.Len() != processOutputLimit || !strings.HasSuffix(b.String(), "taillast") {
		t.Fatal("tail failed")
	}
}

func TestPathResolver(t *testing.T) {
	home := t.TempDir()
	shell := filepath.Join(home, "shell")
	bin := filepath.Join(home, "custom-bin")
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	fakeCLI(t, home, "shell", fmt.Sprintf(`printf 'startup chatter\n__GTPATH__%s:/usr/bin__GTPATH__\nbye'`, bin))
	fakeCLI(t, bin, "codex", `exit 0`)
	t.Setenv("HOME", home)
	t.Setenv("SHELL", shell)
	t.Setenv("PATH", "/bin")
	old := resolvePath
	resolvePath = loginPath
	t.Cleanup(func() { resolvePath = old; pathCache.Lock(); defer pathCache.Unlock(); pathCache.value = "" })
	for _, version := range []string{"v9.9.9", "v22.1.0", "v22.12.0"} {
		if err := os.MkdirAll(filepath.Join(home, ".nvm/versions/node", version, "bin"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	path := loginPath(true)
	if !strings.HasPrefix(path, bin+":") || !strings.Contains(path, "v22.12.0/bin") || strings.Contains(path, "v9.9.9/bin") || !strings.Contains(path, ".claude/local") {
		t.Fatal(path)
	}
	if p, err := lookPath("codex"); err != nil || p != filepath.Join(bin, "codex") {
		t.Fatalf("%s %v", p, err)
	}
	fakeCLI(t, home, "shell", `printf '__GTPATH__/replacement__GTPATH__'`)
	if loginPath(false) != path || !strings.HasPrefix(loginPath(true), "/replacement:") {
		t.Fatal("cache/refresh failed")
	}
}

func TestBundledCodexDiscovery(t *testing.T) {
	home := t.TempDir()
	dirs := bundledCodexDirs("darwin", home)
	if len(dirs) != 8 || len(bundledCodexDirs("linux", home)) != 0 || len(bundledCodexDirs("windows", home)) != 0 {
		t.Fatalf("unexpected application directories: %v", dirs)
	}
	old := resolvePath
	t.Cleanup(func() { resolvePath = old })
	bin := t.TempDir()
	for _, dir := range dirs[:4] {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		fakeCLI(t, dir, "codex", `printf 'codex-cli 0.165.0'`)
		resolvePath = func(bool) string { return bin + ":" + dir }
		if p, err := lookPath(EngineCodex); err != nil || p != filepath.Join(dir, "codex") {
			t.Fatalf("bundled CLI: %s %v", p, err)
		}
		fakeCLI(t, bin, "codex", `exit 0`)
		if p, err := lookPath(EngineCodex); err != nil || p != filepath.Join(bin, "codex") {
			t.Fatalf("PATH precedence: %s %v", p, err)
		}
		if err := os.Remove(filepath.Join(bin, "codex")); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(filepath.Join(dir, "codex"), 0600); err != nil {
			t.Fatal(err)
		}
		if p, err := lookPath(EngineCodex); err == nil {
			t.Fatalf("non-executable accepted: %s", p)
		}
	}
}
