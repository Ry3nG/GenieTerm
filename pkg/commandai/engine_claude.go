// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"encoding/json"
	"os"
	"strings"
)

func claudeArgs(system, model string) []string {
	args := []string{"-p", "--restricted", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--system-prompt", system, "--output-format", "json", "--json-schema", responseSchema}
	// Haiku versions that predate adaptive thinking reject effort controls.
	if !strings.Contains(strings.ToLower(model), "haiku") {
		args = append(args, "--effort", "low")
	}
	if model != "" {
		args = append(args, "--model", model)
	}
	return args
}

type claudeEngine struct{}

func (claudeEngine) run(ctx context.Context, s settings, system, message string) (string, error) {
	path, err := lookPath(EngineClaude)
	if err != nil {
		return "", cliMissing(EngineClaude)
	}
	dir, err := os.MkdirTemp("", "genieterm-commandai-")
	if err != nil {
		return "", failure("Could not prepare Claude Code.")
	}
	defer os.RemoveAll(dir)
	out, stderr, err := runProcess(ctx, path, claudeArgs(system, s.model), dir, message, childEnv())
	if err != nil {
		return "", cliError(ctx, EngineClaude, out, stderr)
	}
	var result struct {
		IsError    bool            `json:"is_error"`
		Result     string          `json:"result"`
		Structured json.RawMessage `json:"structured_output"`
	}
	if json.Unmarshal(out, &result) != nil {
		return "", failure("Claude Code returned an invalid response.")
	}
	if result.IsError {
		return "", cliError(ctx, EngineClaude, []byte(result.Result), stderr)
	}
	if len(result.Structured) > 0 && string(result.Structured) != "null" {
		return string(result.Structured), nil
	}
	return result.Result, nil
}

func cliMissing(id string) error {
	return &engineError{status: StatusUnavailable, detail: "CLI not found on this computer", fix: installCommand(id)}
}

func authFailure(id string) error {
	return &engineError{status: StatusSignedOut, detail: "Not signed in", fix: loginCommand(id)}
}

var authFailureHints = []string{"not logged in", "not signed in", "please log in", "please login", "run codex login", "/login", "401", "unauthorized", "expired", "invalid api key", "authentication"}
var usageLimitHints = []string{"rate limit", "rate_limit", "429", "usage limit", "quota", "too many requests"}
var networkHints = []string{"network", "connection refused", "could not resolve", "dns", "stream disconnected", "unreachable", "econnreset", "tls"}

func containsAny(text string, words []string) bool {
	for _, word := range words {
		if strings.Contains(text, word) {
			return true
		}
	}
	return false
}

// CLI output can echo the prompt, so only fixed messages are ever shown; the output is
// only searched for known failure kinds.
func cliError(ctx context.Context, id string, out, stderr []byte) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	tail := func(b []byte) string {
		if len(b) > 2048 {
			b = b[len(b)-2048:]
		}
		return strings.ToLower(string(b))
	}
	text := tail(out) + "\n" + tail(stderr)
	label := engineLabel(id)
	switch {
	case containsAny(text, authFailureHints):
		return authFailure(id)
	case containsAny(text, usageLimitHints):
		return failure(label + " says you've reached a usage limit. Try again later.")
	case containsAny(text, networkHints):
		return failure(label + " couldn't reach its service. Check your internet connection.")
	}
	return failure(label + " could not complete the request.")
}
