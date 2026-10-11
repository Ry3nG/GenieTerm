// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

const testAnswer = `{"summary":"","proposals":[{"command":"ls -la","explanation":"List files."}]}`

func openAIAnswer(w http.ResponseWriter) {
	_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": testAnswer}}}})
}

func TestOpenAISchemaFallback(t *testing.T) {
	for _, fallbacks := range []int{0, 1, 2} {
		t.Run(fmt.Sprint(fallbacks), func(t *testing.T) {
			cfg := testConfig(t, EngineOpenAI)
			cfg.Settings.CommandAiModel = "test-model"
			key := "secret-test-key"
			getSecret = func(string) (string, bool, error) { return key, true, nil }
			calls := 0
			var gotSystem, gotMessage string
			server := testHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer "+key {
					t.Error("bad request")
				}
				var body struct {
					Model    string                           `json:"model"`
					Messages []struct{ Role, Content string } `json:"messages"`
					Format   map[string]any                   `json:"response_format"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if body.Model != "test-model" || len(body.Messages) != 2 {
					t.Error("missing model/messages")
					w.WriteHeader(500)
					return
				}
				gotSystem = body.Messages[0].Content
				gotMessage = body.Messages[1].Content
				types := []string{"json_schema", "json_object", ""}
				typ, _ := body.Format["type"].(string)
				if typ != types[calls-1] {
					t.Errorf("format=%q", typ)
				}
				if calls <= fallbacks {
					w.WriteHeader(400)
					_, _ = w.Write([]byte(`{"error":"response_format json_schema unsupported"}`))
					return
				}
				openAIAnswer(w)
			}))
			defer server.Close()
			cfg.Settings.CommandAiBaseUrl = server.URL + "/v1"
			req := wshrpc.CommandAiRequest{RequestId: "http", Prompt: "list TOKEN=private-value", Context: wshrpc.CommandAiContext{Distro: "test"}}
			preview, err := Preview(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			result := Run(context.Background(), req)
			if result.Status != StatusOk || result.Model != "test-model" || len(result.Proposals) != 1 || result.Redactions != 1 || result.EngineLabel != "OpenAI-compatible API" || result.RequestId != "http" {
				t.Fatalf("%+v", result)
			}
			if gotSystem != preview.System || gotMessage != preview.Message || strings.Contains(gotMessage, "private-value") || calls != fallbacks+1 {
				t.Fatal("preview/fallback mismatch")
			}
		})
	}
}

func TestHTTPFailures(t *testing.T) {
	for _, tt := range []struct {
		name, engine         string
		code                 int
		body, status, detail string
	}{
		{"unauthorized", EngineOpenAI, 401, `bad`, StatusSignedOut, "The API key was rejected."},
		{"forbidden", EngineOpenAI, 403, `bad`, StatusSignedOut, "The API key was rejected."},
		{"model", EngineOpenAI, 404, `{"error":"model missing"}`, StatusFailed, "Model not found: test-model"},
		{"other 400", EngineOpenAI, 400, `prompt SECRET=must-not-leak`, StatusFailed, "OpenAI-compatible API rejected the request."},
		{"anthropic auth", EngineAnthropic, 401, `bad`, StatusSignedOut, "The API key was rejected."},
		{"large", EngineOpenAI, 200, strings.Repeat("x", httpBodyLimit+1), StatusFailed, "The API response was too large."},
	} {
		t.Run(tt.name, func(t *testing.T) {
			cfg := testConfig(t, tt.engine)
			cfg.Settings.CommandAiModel = "test-model"
			getSecret = func(string) (string, bool, error) { return "test-key", true, nil }
			calls := 0
			server := testHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.WriteHeader(tt.code)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()
			cfg.Settings.CommandAiBaseUrl = server.URL
			r := Run(context.Background(), wshrpc.CommandAiRequest{Prompt: "hi"})
			if r.Status != tt.status || r.StatusDetail != tt.detail || calls != 1 {
				t.Fatalf("%+v calls=%d", r, calls)
			}
		})
	}
}

func TestAnthropicAndModels(t *testing.T) {
	cfg := testConfig(t, EngineAnthropic)
	getSecret = func(string) (string, bool, error) { return "key", true, nil }
	server := testHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "key" || r.Header.Get("anthropic-version") != "2023-06-01" || r.Header.Get("Authorization") != "" {
			t.Error("bad headers")
		}
		if r.URL.Path == "/v1/models" {
			_, _ = w.Write([]byte(`{"data":[{"id":"z"},{"id":"a"}]}`))
			return
		}
		if r.URL.Path != "/v1/messages" {
			t.Error(r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "claude-haiku-5-5" || body["max_tokens"] != float64(1500) || body["tool_choice"].(map[string]any)["name"] != "respond" {
			t.Error(body)
		}
		_, _ = fmt.Fprintf(w, `{"content":[{"type":"text","text":"ignore"},{"type":"tool_use","name":"respond","input":%s}]}`, testAnswer)
	}))
	defer server.Close()
	cfg.Settings.CommandAiBaseUrl = server.URL
	if result := Run(context.Background(), wshrpc.CommandAiRequest{Prompt: "list"}); result.Status != StatusOk || len(result.Proposals) != 1 {
		t.Fatal(result)
	}
	if models := ListModels(context.Background(), wshrpc.CommandAiModelsRequest{Engine: EngineAnthropic}); !reflect.DeepEqual(models.Models, []string{"a", "z"}) || models.Error != "" {
		t.Fatal(models)
	}
}

func TestOllamaAndOpenAIModels(t *testing.T) {
	cfg := testConfig(t, EngineOllama)
	server := testHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("unexpected key")
		}
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[{"name":"qwen3"},{"name":"llama3"}]}`))
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"z"},{"id":"a"},{"id":"z"}]}`))
		case "/v1/chat/completions":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["model"] != "qwen3" {
				t.Error(body)
			}
			openAIAnswer(w)
		default:
			t.Error(r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	cfg.Settings.CommandAiBaseUrl = server.URL
	if r := Run(context.Background(), wshrpc.CommandAiRequest{}); r.Status != StatusOk || r.Model != "qwen3" {
		t.Fatal(r)
	}
	if m := ListModels(context.Background(), wshrpc.CommandAiModelsRequest{}); !reflect.DeepEqual(m.Models, []string{"qwen3", "llama3"}) {
		t.Fatal(m)
	}
	if m := ListModels(context.Background(), wshrpc.CommandAiModelsRequest{Engine: EngineOpenAI, BaseUrl: server.URL + "/v1"}); !reflect.DeepEqual(m.Models, []string{"a", "z"}) {
		t.Fatal(m)
	}
	p, _ := Preview(context.Background(), wshrpc.CommandAiRequest{})
	if !strings.Contains(p.Destination, ", on this computer") {
		t.Fatal(p.Destination)
	}
}

func TestHTTPTimeoutAndOutputPolicy(t *testing.T) {
	cfg := testConfig(t, EngineOpenAI)
	cfg.Settings.CommandAiModel = "test"
	off := false
	cfg.Settings.CommandAiIncludeOutput = &off
	p, _ := Preview(context.Background(), wshrpc.CommandAiRequest{Context: wshrpc.CommandAiContext{Distro: "test", Output: "private-output"}})
	// The setting only preselects the sheet's checkbox; output in the request is sent.
	if !strings.Contains(p.Message, "private-output") {
		t.Fatal("output in the request was dropped")
	}
	server := testHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(200 * time.Millisecond):
		}
	}))
	defer server.Close()
	cfg.Settings.CommandAiBaseUrl = server.URL
	old := apiTimeout
	apiTimeout = 30 * time.Millisecond
	defer func() { apiTimeout = old }()
	r := Run(context.Background(), wshrpc.CommandAiRequest{})
	if r.Status != StatusTimeout || r.StatusDetail != "OpenAI-compatible API took too long to answer." {
		t.Fatal(r)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r = Run(ctx, wshrpc.CommandAiRequest{})
	if r.Status != StatusCanceled {
		t.Fatal(r)
	}
}

func testHTTPServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	server := httptest.NewTestServer(t, handler)
	old := httpClient
	httpClient = server.Client()
	httpClient.CheckRedirect = old.CheckRedirect
	server.URL = "http://localhost"
	t.Cleanup(func() { httpClient = old })
	return server
}
