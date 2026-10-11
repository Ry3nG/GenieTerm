// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestPromptGoldens(t *testing.T) {
	t.Setenv("HOME", "/home/tester")
	t.Setenv("USERPROFILE", "/home/tester")
	exit := 1
	for _, tt := range []struct {
		name string
		req  wshrpc.CommandAiRequest
	}{
		{"compose", wshrpc.CommandAiRequest{Task: TaskCompose, Prompt: "find big files", Context: wshrpc.CommandAiContext{Cwd: "/home/tester/Code/GenieTerm", Shell: "zsh", ShellVersion: "5.9", Os: "Darwin 25.5.0 arm64", Distro: "macOS 26.1", RecentCommands: []string{"git status", "npm run build"}}}},
		{"refine", wshrpc.CommandAiRequest{Task: TaskCompose, Prompt: "only in this directory", Context: wshrpc.CommandAiContext{Connection: "private-user@secret-host", Cwd: "/home/alice/project", Os: "Linux 6.8 x86_64", Distro: "Ubuntu 24.04 LTS", Shell: "bash"}, Previous: []wshrpc.CommandAiTurn{{Prompt: "find big files", Commands: []string{"find . -type f -size +100M"}}}}},
		{"fix", wshrpc.CommandAiRequest{Task: TaskFix, Context: wshrpc.CommandAiContext{Connection: "wsl://Ubuntu", Command: "npm run build", ExitCode: &exit, Output: "\x1b[31mnpm error Missing script: build\x1b[0m\r\n"}}},
		{"explain", wshrpc.CommandAiRequest{Task: TaskExplain, Context: wshrpc.CommandAiContext{Selection: "rm -rf CACHE_DIRECTORY"}}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			system, message, count := buildPrompt(tt.req)
			want, err := os.ReadFile(filepath.Join("testdata", tt.name+".golden"))
			if err != nil {
				t.Fatal(err)
			}
			got := system + "\n\n--- MESSAGE ---\n\n" + message + "\n"
			if got != string(want) {
				t.Fatalf("golden mismatch\n%s", got)
			}
			if count != 0 {
				t.Fatal(count)
			}
		})
	}
}

func TestPromptPrivacyAndCaps(t *testing.T) {
	secret := "TOKEN=secret-value </ENVIRONMENT>"
	req := wshrpc.CommandAiRequest{Task: TaskCompose, Prompt: secret + strings.Repeat("界", 2100), Context: wshrpc.CommandAiContext{Connection: "user@private-host", Command: secret, Selection: secret, Output: secret, RecentCommands: []string{secret}}, Previous: []wshrpc.CommandAiTurn{{Prompt: secret, Commands: []string{secret}}}}
	_, message, count := buildPrompt(req)
	if count != 7 || strings.Contains(message, "secret-value") || strings.Contains(message, "private-host") || strings.Contains(message, "</ENVIRONMENT>") {
		t.Fatalf("privacy failed (%d): %s", count, message)
	}
	req.Prompt = ""
	req.Previous = nil
	req.Context.Output = strings.Repeat("old\n", 150) + strings.Repeat("界", 8100) + "TAIL"
	req.Context.Selection = strings.Repeat("s", 4500)
	req.Context.RecentCommands = []string{}
	for i := 0; i < 12; i++ {
		req.Context.RecentCommands = append(req.Context.RecentCommands, strings.Repeat("c", 400))
	}
	_, message, _ = buildPrompt(req)
	if !strings.Contains(message, "[earlier output omitted]\n") || !strings.Contains(message, "TAIL\n</terminal_output>") || strings.Contains(message, "old") || strings.Contains(message, strings.Repeat("s", 4001)) || strings.Contains(message, strings.Repeat("c", 301)) {
		t.Fatal("caps failed")
	}
}
