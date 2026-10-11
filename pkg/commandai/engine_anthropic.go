// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"encoding/json"
	"net/http"
)

type anthropicEngine struct{}

func (anthropicEngine) run(ctx context.Context, s settings, system, message string) (string, error) {
	if apiKey(s.engine) == "" {
		return "", &engineError{status: StatusNotConfigured, detail: "Add an API key in Settings → Command AI."}
	}
	body := map[string]any{"model": s.model, "max_tokens": 1500, "system": system, "messages": []map[string]string{{"role": "user", "content": message}}, "tools": []map[string]any{{"name": "respond", "description": "Return the answer.", "input_schema": json.RawMessage(responseSchema)}}, "tool_choice": map[string]string{"type": "tool", "name": "respond"}}
	data, code, err := httpRequest(ctx, s, http.MethodPost, "/v1/messages", body)
	if err != nil {
		return "", err
	}
	if err = httpStatusError(code, data, s); err != nil {
		return "", err
	}
	var response struct {
		Content []struct {
			Type  string          `json:"type"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
	}
	if json.Unmarshal(data, &response) != nil {
		return "", failure("The API returned an invalid response.")
	}
	for _, block := range response.Content {
		if block.Type == "tool_use" && block.Name == "respond" {
			return string(block.Input), nil
		}
	}
	return "", nil
}
