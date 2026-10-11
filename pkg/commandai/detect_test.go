//go:build !windows

// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestCLIDetection(t *testing.T) {
	testConfig(t, EngineCodex)
	dir := fakePath(t)
	fakeCLI(t, dir, EngineCodex, `if [ "$1" = --version ]; then printf 'codex-cli 0.162.1'; else printf 'Logged in using ChatGPT' >&2; fi`)
	fakeCLI(t, dir, EngineClaude, `if [ "$1" = --version ]; then printf '2.1.295 (Claude Code)'; else printf '%s' '{"loggedIn":true,"authMethod":"oauth","subscriptionType":"max","email":"private@example.com","org":"private"}'; fi`)
	for _, id := range []string{EngineCodex, EngineClaude} {
		info := detectOne(context.Background(), resolveSettings(wshrpc.CommandAiRequest{Engine: id}), true)
		if !info.Available || !info.SignedIn || info.Version == "" || strings.Contains(info.Account, "private") {
			t.Fatal(info)
		}
		if id == EngineCodex && info.Account != "ChatGPT" || id == EngineClaude && info.Account != "Claude Max" {
			t.Fatal(info)
		}
	}
	fakeCLI(t, dir, EngineCodex, `if [ "$1" = --version ]; then printf '0.162.1'; else printf 'not signed in'; exit 1; fi`)
	s := resolveSettings(wshrpc.CommandAiRequest{Engine: EngineCodex})
	if info := detectOne(context.Background(), s, false); !info.SignedIn {
		t.Fatal("cache bypassed")
	}
	if info := detectOne(context.Background(), s, true); info.SignedIn || info.Detail != "Not signed in" || info.FixCommand != "codex login" {
		t.Fatal(info)
	}
	fakeCLI(t, dir, EngineClaude, `if [ "$1" = --version ]; then printf '2.1.295'; else printf '%s' '{"loggedIn":false}'; fi`)
	if info := detectOne(context.Background(), resolveSettings(wshrpc.CommandAiRequest{Engine: EngineClaude}), true); info.SignedIn || info.FixCommand != "claude auth login" {
		t.Fatal(info)
	}
	old := resolvePath
	resolvePath = func(bool) string { return t.TempDir() }
	defer func() { resolvePath = old }()
	for _, id := range []string{EngineCodex, EngineClaude} {
		info := detectOne(context.Background(), resolveSettings(wshrpc.CommandAiRequest{Engine: id}), true)
		if info.Available || info.Detail != "Not installed" || info.FixCommand != installCommand(id) {
			t.Fatal(info)
		}
	}
}

func TestAPIDetection(t *testing.T) {
	cfg := testConfig(t, EngineOllama)
	fakePath(t)
	server := testHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"models":[]}`)) }))
	cfg.Settings.CommandAiBaseUrl = server.URL
	info := detectOne(context.Background(), resolveSettings(wshrpc.CommandAiRequest{}), true)
	if !info.Available || !info.SignedIn || info.Detail != "No models yet" || info.FixCommand != "ollama pull qwen3" {
		t.Fatal(info)
	}
	status := GetStatus(context.Background(), true)
	if !status.Enabled || !status.Ready || len(status.Engines) != 5 {
		t.Fatal(status)
	}
	server.Close()
	info = detectOne(context.Background(), resolveSettings(wshrpc.CommandAiRequest{}), true)
	if info.Available || info.Detail != "Not running" || info.FixCommand != "ollama serve" {
		t.Fatal(info)
	}
	for _, tt := range []struct {
		id, base, model string
		available       bool
	}{{EngineOpenAI, "https://api.openai.com/v1", "gpt-5.5", false}, {EngineOpenAI, "http://localhost:1234/v1", "", true}, {EngineOpenAI, "https://example.com/v1", "", false}, {EngineAnthropic, "https://api.anthropic.com", "claude-haiku-5-5", false}} {
		info := detectOne(context.Background(), resolveSettings(wshrpc.CommandAiRequest{Engine: tt.id, BaseUrl: tt.base}), true)
		if info.Available != tt.available || info.DefaultModel != tt.model || !info.NeedsKey || info.HasKey {
			t.Fatal(info)
		}
	}
	getSecret = func(string) (string, bool, error) { return "private", true, nil }
	info = detectOne(context.Background(), resolveSettings(wshrpc.CommandAiRequest{Engine: EngineAnthropic}), false)
	if !info.HasKey || !info.Available {
		t.Fatal(info)
	}
}
