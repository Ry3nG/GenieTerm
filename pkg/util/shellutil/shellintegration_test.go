// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"text/template"
	"time"

	"github.com/creack/pty"
)

var osc16162Re = regexp.MustCompile(`\x1b\]16162;([A-Z])(?:;([^\x07]*))?\x07`)

type siMarker struct {
	Cmd     string
	Payload map[string]any
}

func (m siMarker) String() string {
	if m.Payload == nil {
		return m.Cmd
	}
	barr, _ := json.Marshal(m.Payload)
	return m.Cmd + " " + string(barr)
}

func allIntegrationScripts() map[string]string {
	return map[string]string{
		"zsh_zprofile.sh":  ZshStartup_Zprofile,
		"zsh_zshrc.sh":     ZshStartup_Zshrc,
		"zsh_zlogin.sh":    ZshStartup_Zlogin,
		"zsh_zshenv.sh":    ZshStartup_Zshenv,
		"bash_bashrc.sh":   BashStartup_Bashrc,
		"fish_wavefish.sh": FishStartup_Wavefish,
		"pwsh_wavepwsh.sh": PwshStartup_wavepwsh,
		"bash_preexec.sh":  BashStartup_Preexec,
	}
}

func TestIntegrationScriptTemplatesParse(t *testing.T) {
	params := map[string]string{
		"WSHBINDIR":      HardQuote("/tmp/wave bin"),
		"WSHBINDIR_PWSH": HardQuotePowerShell("/tmp/wave bin"),
		"HELPERCMD":      "genie",
		"PATHSEP":        ":",
	}
	for name, text := range allIntegrationScripts() {
		if name == "bash_preexec.sh" {
			// written verbatim, not as a template
			continue
		}
		tmpl, err := template.New(name).Option("missingkey=error").Parse(text)
		if err != nil {
			t.Fatalf("%s: template parse error: %v", name, err)
		}
		var out bytes.Buffer
		if err := tmpl.Execute(&out, params); err != nil {
			t.Fatalf("%s: template execute error: %v", name, err)
		}
		if strings.Contains(out.String(), "{{") || strings.Contains(out.String(), "<no value>") {
			t.Fatalf("%s: unexpanded template text in output", name)
		}
	}
}

// GNU/BusyBox base64 wrap at 76 columns; every encoder pipeline must strip the newlines or
// commands longer than 57 bytes produce a corrupt cmd64/buf64 payload on Linux.
func TestIntegrationScriptsUnwrapBase64(t *testing.T) {
	for name, text := range allIntegrationScripts() {
		if name == "bash_preexec.sh" || strings.HasPrefix(name, "pwsh_") {
			continue
		}
		if strings.Contains(text, `string replace -a '\n'`) {
			t.Errorf("%s: fish single-quoted '\\n' is a literal backslash-n, not a newline", name)
		}
		for idx, line := range strings.Split(text, "\n") {
			if !strings.Contains(line, "| base64") {
				continue
			}
			if !strings.Contains(line, `| tr -d '\n\r'`) {
				t.Errorf("%s:%d: base64 output is not unwrapped: %s", name, idx+1, strings.TrimSpace(line))
			}
		}
	}
}

// users with `set -u` / `setopt nounset` would otherwise abort our hooks (no D/A markers).
func TestIntegrationScriptsNounsetSafe(t *testing.T) {
	unguarded := regexp.MustCompile(`\$(TMUX|STY|ZSH|HISTFILE|ZDOTDIR|WAVETERM_SWAPTOKEN)\b`)
	for _, name := range []string{"bash_bashrc.sh", "zsh_zshrc.sh", "zsh_zshenv.sh", "zsh_zlogin.sh"} {
		text := allIntegrationScripts()[name]
		for idx, line := range strings.Split(text, "\n") {
			if match := unguarded.FindString(line); match != "" {
				t.Errorf("%s:%d: unguarded %s (use ${VAR:-}): %s", name, idx+1, match, strings.TrimSpace(line))
			}
		}
	}
}

func renderRcFiles(t *testing.T) string {
	t.Helper()
	waveHome := t.TempDir()
	for _, dir := range []string{ZshIntegrationDir, BashIntegrationDir, FishIntegrationDir, PwshIntegrationDir} {
		if err := os.MkdirAll(filepath.Join(waveHome, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := InitRcFiles(waveHome, filepath.Join(waveHome, "bin")); err != nil {
		t.Fatalf("InitRcFiles: %v", err)
	}
	return waveHome
}

type siSession struct {
	t    *testing.T
	ptmx pty.Pty
	cmd  *exec.Cmd
	lock sync.Mutex
	buf  bytes.Buffer
	done chan struct{}
}

func (s *siSession) output() []byte {
	s.lock.Lock()
	defer s.lock.Unlock()
	return append([]byte(nil), s.buf.Bytes()...)
}

func (s *siSession) appendOutput(data []byte) {
	s.lock.Lock()
	defer s.lock.Unlock()
	s.buf.Write(data)
}

func (s *siSession) countPrompts() int {
	return bytes.Count(s.output(), []byte("\x1b]16162;A\x07"))
}

func (s *siSession) waitForPrompts(n int) {
	s.t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for s.countPrompts() < n {
		if time.Now().After(deadline) {
			s.t.Fatalf("timed out waiting for prompt #%d; output:\n%q", n, s.output())
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func startSiSession(t *testing.T, env []string, name string, args ...string) *siSession {
	t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Env = env
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 40, Cols: 200})
	if err != nil {
		t.Skipf("cannot start %s in a pty: %v", name, err)
	}
	s := &siSession{t: t, ptmx: ptmx, cmd: cmd, done: make(chan struct{})}
	go func() {
		defer close(s.done)
		rbuf := make([]byte, 4096)
		for {
			nr, err := ptmx.Read(rbuf)
			if nr > 0 {
				s.appendOutput(rbuf[:nr])
			}
			if err != nil {
				return
			}
		}
	}()
	t.Cleanup(func() {
		cmd.Process.Kill()
		cmd.Wait()
		ptmx.Close()
	})
	return s
}

// runs each input line as its own interactive command and returns the OSC 16162 markers emitted
func (s *siSession) runCommands(inputs []string) []siMarker {
	s.t.Helper()
	s.waitForPrompts(1)
	for idx, input := range inputs {
		if _, err := s.ptmx.Write([]byte(input + "\r")); err != nil {
			s.t.Fatalf("write input: %v", err)
		}
		s.waitForPrompts(idx + 2)
	}
	s.ptmx.Write([]byte("exit\r"))
	select {
	case <-s.done:
	case <-time.After(10 * time.Second):
	}
	return parseSiMarkers(s.t, s.output())
}

func parseSiMarkers(t *testing.T, data []byte) []siMarker {
	t.Helper()
	var rtn []siMarker
	for _, m := range osc16162Re.FindAllSubmatch(data, -1) {
		marker := siMarker{Cmd: string(m[1])}
		if marker.Cmd == "I" {
			continue
		}
		if len(m[2]) > 0 {
			if err := json.Unmarshal(m[2], &marker.Payload); err != nil {
				t.Fatalf("bad JSON in %s marker: %q (%v)", marker.Cmd, m[2], err)
			}
			if cmd64, ok := marker.Payload["cmd64"].(string); ok {
				decoded, err := base64.StdEncoding.DecodeString(cmd64)
				if err != nil {
					t.Fatalf("bad cmd64 %q: %v", cmd64, err)
				}
				delete(marker.Payload, "cmd64")
				marker.Payload["cmd"] = string(decoded)
			}
		}
		rtn = append(rtn, marker)
	}
	return rtn
}

// collapses the marker stream to "C <cmd>" / "C" / "D <exit>" lines (dropping M and A)
func summarizeCommandMarkers(markers []siMarker) []string {
	var rtn []string
	for _, m := range markers {
		switch m.Cmd {
		case "C":
			if cmd, ok := m.Payload["cmd"].(string); ok {
				rtn = append(rtn, "C "+cmd)
			} else {
				rtn = append(rtn, "C")
			}
		case "D":
			rtn = append(rtn, fmt.Sprintf("D %v", m.Payload["exitcode"]))
		}
	}
	return rtn
}

func requireUnixShell(t *testing.T, shell string) string {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping interactive shell test in short mode")
	}
	if runtime.GOOS == "windows" {
		t.Skip("pty shell tests are unix-only")
	}
	shellPath, err := exec.LookPath(shell)
	if err != nil {
		t.Skipf("%s not installed", shell)
	}
	return shellPath
}

const longTestCommand = "echo 'a long command that is definitely longer than fifty seven bytes for base64 wrapping'"

func TestBashIntegrationMarkers(t *testing.T) {
	bashPath := requireUnixShell(t, "bash")
	waveHome := renderRcFiles(t)
	home := t.TempDir()
	profile := "set -u\nHISTCONTROL=ignoredups\nHISTIGNORE='false'\n"
	if err := os.WriteFile(filepath.Join(home, ".bash_profile"), []byte(profile), 0644); err != nil {
		t.Fatal(err)
	}
	env := []string{"HOME=" + home, "PATH=/usr/bin:/bin", "TERM=xterm-256color"}
	rcFile := filepath.Join(waveHome, BashIntegrationDir, ".bashrc")
	s := startSiSession(t, env, bashPath, "--noprofile", "--rcfile", rcFile, "-i")
	markers := s.runCommands([]string{
		"echo one",
		"echo one",
		"export HISTCONTROL=ignoreboth",
		" echo secret | cat",
		"false",
		longTestCommand,
	})
	got := summarizeCommandMarkers(markers)
	want := []string{
		"C echo one", "D 0",
		// ignoredups: a genuine repeat keeps its text even though no history entry is added
		"C echo one", "D 0",
		"C export HISTCONTROL=ignoreboth", "D 0",
		// ignorespace / HISTIGNORE: no history entry, so no (stale) text
		"C", "D 0",
		"C", "D 1",
		"C " + longTestCommand, "D 0",
		"C exit",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("unexpected bash markers\ngot:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestZshIntegrationMarkers(t *testing.T) {
	zshPath := requireUnixShell(t, "zsh")
	waveHome := renderRcFiles(t)
	home := t.TempDir()
	if err := os.WriteFile(filepath.Join(home, ".zshrc"), []byte("setopt nounset\n"), 0644); err != nil {
		t.Fatal(err)
	}
	zdotDir := filepath.Join(waveHome, ZshIntegrationDir)
	env := []string{"HOME=" + home, "PATH=/usr/bin:/bin", "TERM=xterm-256color", "ZDOTDIR=" + zdotDir}
	s := startSiSession(t, env, zshPath, "-i")
	got := summarizeCommandMarkers(s.runCommands([]string{"echo one", "false", longTestCommand}))
	want := []string{
		"C echo one", "D 0",
		"C false", "D 1",
		"C " + longTestCommand, "D 0",
		"C exit",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("unexpected zsh markers\ngot:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}
