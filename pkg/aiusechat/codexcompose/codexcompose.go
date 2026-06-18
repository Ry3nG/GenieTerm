// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package codexcompose is a self-contained, keyless one-shot text client for the
// command composer. It reuses the user's existing Codex / ChatGPT login
// (~/.codex/auth.json) and calls the Codex Responses endpoint. It deliberately
// does NOT plug into the streaming chat backend in this package — it's an
// isolated helper so it can't affect the interactive AI chat path.
//
// The endpoint is undocumented/reverse-engineered and may change; callers must
// treat any error as non-fatal and fall back to a local generator.
package codexcompose

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	codexResponsesURL = "https://chatgpt.com/backend-api/codex/responses"
	defaultCodexModel = "gpt-5.5"
	requestTimeout    = 60 * time.Second
)

var configModelRe = regexp.MustCompile(`(?m)^\s*model\s*=\s*"([^"]+)"`)

type codexAuth struct {
	AccessToken string
	AccountID   string
}

// readCodexAuth loads the access token + account id from the user's Codex login.
// Returns an error (not a panic) when Codex isn't logged in so callers can fall back.
func readCodexAuth() (*codexAuth, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(home, ".codex", "auth.json"))
	if err != nil {
		return nil, fmt.Errorf("no Codex login found (~/.codex/auth.json): %w", err)
	}
	var parsed struct {
		Tokens struct {
			AccessToken string `json:"access_token"`
			AccountID   string `json:"account_id"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, fmt.Errorf("could not parse ~/.codex/auth.json: %w", err)
	}
	if parsed.Tokens.AccessToken == "" || parsed.Tokens.AccountID == "" {
		return nil, fmt.Errorf("Codex login is incomplete (no access token / account id)")
	}
	return &codexAuth{AccessToken: parsed.Tokens.AccessToken, AccountID: parsed.Tokens.AccountID}, nil
}

// IsAvailable reports whether a usable Codex login is present.
func IsAvailable() bool {
	_, err := readCodexAuth()
	return err == nil
}

// codexModel returns the model from ~/.codex/config.toml, or the default. The
// model must be one the ChatGPT account is allowed to use (e.g. gpt-5.5);
// arbitrary api model names are rejected by the endpoint.
func codexModel() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return defaultCodexModel
	}
	data, err := os.ReadFile(filepath.Join(home, ".codex", "config.toml"))
	if err != nil {
		return defaultCodexModel
	}
	if m := configModelRe.FindSubmatch(data); m != nil {
		return string(m[1])
	}
	return defaultCodexModel
}

// ComposeText sends a one-shot prompt and returns the accumulated assistant text.
func ComposeText(ctx context.Context, systemPrompt string, userPrompt string) (string, error) {
	auth, err := readCodexAuth()
	if err != nil {
		return "", err
	}
	reqBody := map[string]any{
		"model":        codexModel(),
		"instructions": systemPrompt,
		"input": []map[string]any{
			{
				"type":    "message",
				"role":    "user",
				"content": []map[string]any{{"type": "input_text", "text": userPrompt}},
			},
		},
		"stream": true,
		"store":  false,
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}
	reqCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, codexResponsesURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+auth.AccessToken)
	httpReq.Header.Set("ChatGPT-Account-ID", auth.AccountID)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("OpenAI-Beta", "responses=experimental")
	httpReq.Header.Set("originator", "codex_cli_rs")
	httpReq.Header.Set("session_id", uuid.New().String())
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		snippet, _ := bufio.NewReader(resp.Body).Peek(400)
		if resp.StatusCode == http.StatusUnauthorized {
			return "", fmt.Errorf("Codex login expired — run `codex` once to refresh (HTTP 401)")
		}
		return "", fmt.Errorf("codex responses HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
	return accumulateSSEText(resp.Body)
}

// accumulateSSEText reads the Responses-API SSE stream and concatenates the
// output_text deltas into the final assistant text.
func accumulateSSEText(body io.Reader) (string, error) {
	var sb strings.Builder
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var evt struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
		}
		if err := json.Unmarshal([]byte(payload), &evt); err != nil {
			continue
		}
		if evt.Type == "response.output_text.delta" {
			sb.WriteString(evt.Delta)
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return strings.TrimSpace(sb.String()), nil
}
