// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/Ry3nG/GenieTerm/pkg/secretstore"
)

const httpBodyLimit = 2 * 1024 * 1024

var httpClient = &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

var getSecret = secretstore.GetSecret

type openaiEngine struct{}

var nonSecretNameChars = regexp.MustCompile(`[^A-Z0-9]+`)

// A key belongs to the service it was entered for. Each endpoint has its own secret, so
// pointing the engine at another server never sends it a key saved for a different one.
func apiKeySecretName(id, base string) string {
	host := baseHost(base)
	if u, err := url.Parse(base); err == nil && u.Port() != "" {
		host += "_" + u.Port()
	}
	switch {
	case id == EngineOpenAI && host == "api.openai.com":
		return SecretOpenAIKey
	case id == EngineAnthropic && host == "api.anthropic.com":
		return SecretAnthropicKey
	case id != EngineOpenAI && id != EngineAnthropic, host == "":
		return ""
	}
	return "COMMANDAI_KEY_" + strings.Trim(nonSecretNameChars.ReplaceAllString(strings.ToUpper(host), "_"), "_")
}

func apiKey(s settings) string {
	name := apiKeySecretName(s.engine, s.base)
	if name == "" {
		return ""
	}
	value, ok, err := getSecret(name)
	if err != nil || !ok {
		return ""
	}
	return value
}

func httpRequest(ctx context.Context, s settings, method, path string, body any) ([]byte, int, error) {
	base, err := url.Parse(s.base)
	if err != nil || base.Host == "" || (base.Scheme != "http" && base.Scheme != "https") || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return nil, 0, &engineError{status: StatusNotConfigured, detail: "Choose a valid API base URL in Settings → Command AI."}
	}
	var encoded []byte
	if body != nil {
		encoded, err = json.Marshal(body)
		if err != nil {
			return nil, 0, failure("Could not prepare the API request.")
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, s.base+path, bytes.NewReader(encoded))
	if err != nil {
		return nil, 0, failure("Could not prepare the API request.")
	}
	req.Header.Set("Content-Type", "application/json")
	key := apiKey(s)
	if s.engine == EngineAnthropic {
		if key != "" {
			req.Header.Set("x-api-key", key)
		}
		req.Header.Set("anthropic-version", "2023-06-01")
	} else if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := httpClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, 0, ctx.Err()
		}
		return nil, 0, &engineError{status: StatusUnavailable, detail: engineLabel(s.engine) + " could not be reached."}
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, httpBodyLimit+1))
	if err != nil {
		return nil, response.StatusCode, failure("Could not read the API response.")
	}
	if len(data) > httpBodyLimit {
		return nil, response.StatusCode, failure("The API response was too large.")
	}
	return data, response.StatusCode, nil
}

func httpStatusError(code int, data []byte, s settings) error {
	if code >= 200 && code < 300 {
		return nil
	}
	if code == 401 || code == 403 {
		return &engineError{status: StatusSignedOut, detail: "The API key was rejected."}
	}
	if code == 404 && strings.Contains(strings.ToLower(string(data)), "model") {
		model, _ := Redact(s.model)
		return failure("Model not found: " + limit(cleanText(model, false), 200))
	}
	return failure(engineLabel(s.engine) + " rejected the request.")
}

func schemaRejected(code int, data []byte) bool {
	if code != 400 && code != 422 {
		return false
	}
	text := strings.ToLower(string(data))
	return strings.Contains(text, "response_format") || strings.Contains(text, "json_schema") || strings.Contains(text, "schema")
}

func (openaiEngine) run(ctx context.Context, s settings, system, message string) (string, error) {
	if s.engine == EngineOpenAI && apiKey(s) == "" && !localBase(s.base) {
		return "", &engineError{status: StatusNotConfigured, detail: "Add an API key in Settings → Command AI."}
	}
	if s.engine == EngineOllama {
		s.base = strings.TrimSuffix(s.base, "/v1") + "/v1"
	}
	body := map[string]any{"model": s.model, "messages": []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": message}}, "response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "command_ai", "strict": true, "schema": json.RawMessage(responseSchema)}}}
	for attempt := 0; attempt < 3; attempt++ {
		data, code, err := httpRequest(ctx, s, http.MethodPost, "/chat/completions", body)
		if err != nil {
			return "", err
		}
		if schemaRejected(code, data) && attempt < 2 {
			if attempt == 0 {
				body["response_format"] = map[string]string{"type": "json_object"}
			} else {
				delete(body, "response_format")
			}
			continue
		}
		if err = httpStatusError(code, data, s); err != nil {
			return "", err
		}
		var response struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if json.Unmarshal(data, &response) != nil {
			return "", failure("The API returned an invalid response.")
		}
		if len(response.Choices) == 0 {
			return "", nil
		}
		return response.Choices[0].Message.Content, nil
	}
	return "", failure("The API rejected the response format.")
}

func fetchModels(ctx context.Context, s settings) ([]string, error) {
	path := "/models"
	switch s.engine {
	case EngineCodex, EngineClaude:
		return []string{}, nil
	case EngineAnthropic:
		path = "/v1/models"
	case EngineOllama:
		path = "/api/tags"
		s.base = strings.TrimSuffix(s.base, "/v1")
	case EngineOpenAI:
	default:
		return nil, &engineError{status: StatusNotConfigured, detail: "Choose an engine in Settings → Command AI."}
	}
	data, code, err := httpRequest(ctx, s, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	if err = httpStatusError(code, data, s); err != nil {
		return nil, err
	}
	var response struct {
		Data []struct {
			Id string `json:"id"`
		} `json:"data"`
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if json.Unmarshal(data, &response) != nil {
		return nil, failure("The API returned an invalid model list.")
	}
	models := []string{}
	seen := map[string]bool{}
	add := func(s string) {
		if s != "" && !seen[s] {
			seen[s] = true
			models = append(models, s)
		}
	}
	if s.engine == EngineOllama {
		for _, m := range response.Models {
			add(m.Name)
		}
	} else {
		for _, m := range response.Data {
			add(m.Id)
		}
		sort.Strings(models)
	}
	return models, nil
}
