// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func startPowerShellIntegrationSession(t *testing.T, shell string) *siSession {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping interactive shell test in short mode")
	}
	shellPath, err := exec.LookPath(shell)
	if err != nil {
		if shell == "powershell.exe" {
			t.Fatal(err)
		}
		t.Skip("PowerShell 7 is not installed")
	}
	waveHome := renderRcFiles(t)
	rcFile := filepath.Join(waveHome, PwshIntegrationDir, "wavepwsh.ps1")
	original, err := os.ReadFile(rcFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rcFile, []byte("\ufefffunction global:genie { if ($args[0] -eq 'completion') { '# test completion' } }\n"+strings.TrimPrefix(string(original), "\ufeff")), 0600); err != nil {
		t.Fatal(err)
	}
	return startSiSession(t, append(os.Environ(), "TERM=xterm-256color"), shellPath, "-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", rcFile)
}

func TestPowerShellIntegrationMarkers(t *testing.T) {
	for _, shell := range []string{"powershell.exe", "pwsh.exe"} {
		t.Run(shell, func(t *testing.T) {
			session := startPowerShellIntegrationSession(t, shell)
			inputs := []string{
				"Write-Output 'hello'",
				"cmd.exe /d /c exit 7",
				"cmd.exe /d /c exit 7",
				"Write-Error 'failed'",
				"Write-Output '你好 Windows'",
				"Write-Output 'hello'",
			}
			markers := session.runCommands(inputs)
			got := summarizeCommandMarkers(markers)
			want := []string{
				"C " + inputs[0], "D 0",
				"C " + inputs[1], "D 7",
				"C " + inputs[2], "D 7",
				"C " + inputs[3], "D 1",
				"C " + inputs[4], "D 0",
				"C " + inputs[5], "D 0",
				"C exit",
			}
			if strings.Join(got, "\n") != strings.Join(want, "\n") {
				t.Fatalf("unexpected PowerShell command markers\ngot:\n%s\nwant:\n%s\noutput:\n%q", strings.Join(got, "\n"), strings.Join(want, "\n"), session.output())
			}
		})
	}
}

func TestPowerShellIntegrationOutputOrdering(t *testing.T) {
	for _, shell := range []string{"powershell.exe", "pwsh.exe"} {
		t.Run(shell, func(t *testing.T) {
			session := startPowerShellIntegrationSession(t, shell)
			inputs := make([]string, 16)
			for i := range inputs {
				// The complete output token must not also occur in the echoed command.
				inputs[i] = fmt.Sprintf("Write-Output ('GT_ORDER_' + '%02d_alpha'); Write-Output ('GT_ORDER_' + '%02d_beta')", i, i)
			}
			session.runCommands(inputs)
			commands := strings.Split(string(session.output()), "\x1b]16162;C;")
			if len(commands) != len(inputs)+2 {
				t.Fatalf("expected %d commands and exit, got %d", len(inputs), len(commands)-1)
			}
			for i := range inputs {
				command := commands[i+1]
				done := strings.Index(command, "\x1b]16162;D;")
				prompt := strings.Index(command, "\x1b]16162;A\x07")
				alpha := strings.Index(command, fmt.Sprintf("GT_ORDER_%02d_alpha", i))
				beta := strings.Index(command, fmt.Sprintf("GT_ORDER_%02d_beta", i))
				if alpha < 0 || beta < alpha || done < beta || prompt < done {
					t.Fatalf("command %d output must precede completion and next prompt (alpha=%d beta=%d done=%d prompt=%d): %q", i, alpha, beta, done, prompt, command)
				}
			}
		})
	}
}
