// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

// Package commandai turns a request into shell-command proposals using an engine
// the user already has: a signed-in agent CLI, a local model, or their own API key.
// It never runs a proposed command.
package commandai

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

const (
	EngineCodex     = "codex"
	EngineClaude    = "claude"
	EngineOllama    = "ollama"
	EngineOpenAI    = "openai"
	EngineAnthropic = "anthropic"
)

const (
	KindCli   = "cli"
	KindLocal = "local"
	KindApi   = "api"
)

const (
	TaskCompose = "compose"
	TaskFix     = "fix"
	TaskExplain = "explain"
)

const (
	StatusOk            = "ok"
	StatusDisabled      = "disabled"
	StatusNotConfigured = "notconfigured"
	StatusUnavailable   = "unavailable"
	StatusSignedOut     = "signedout"
	StatusFailed        = "failed"
	StatusTimeout       = "timeout"
	StatusCanceled      = "canceled"
	StatusEmpty         = "empty"
)

const (
	SecretOpenAIKey    = "COMMANDAI_OPENAI_KEY"
	SecretAnthropicKey = "COMMANDAI_ANTHROPIC_KEY"
)

type settings struct {
	engine, model, base string
	config              wconfig.FullConfigType
}

type engine interface {
	run(context.Context, settings, string, string) (string, error)
}

type engineError struct{ status, detail, fix string }

func (e *engineError) Error() string { return e.detail }

func failure(detail string) error { return &engineError{status: StatusFailed, detail: detail} }

var getConfig = func() wconfig.FullConfigType { return wconfig.GetWatcher().GetFullConfig() }

var cliTimeout = 90 * time.Second
var apiTimeout = 60 * time.Second
var activeRequests = struct {
	sync.Mutex
	entries map[string]*activeRequest
}{entries: make(map[string]*activeRequest)}

type activeRequest struct{ cancel context.CancelFunc }

func engineLabel(id string) string {
	switch id {
	case EngineCodex:
		return "Codex"
	case EngineClaude:
		return "Claude Code"
	case EngineOllama:
		return "Ollama"
	case EngineOpenAI:
		return "OpenAI-compatible API"
	case EngineAnthropic:
		return "Anthropic API"
	}
	return ""
}

func resolveSettings(req wshrpc.CommandAiRequest) settings {
	config := getConfig()
	s := settings{engine: config.Settings.CommandAiEngine, model: config.Settings.CommandAiModel, base: config.Settings.CommandAiBaseUrl, config: config}
	if req.Engine != "" && req.Engine != s.engine {
		s.model = ""
		s.base = ""
	}
	if req.Engine != "" {
		s.engine = req.Engine
	}
	if req.Model != "" {
		s.model = req.Model
	}
	if req.BaseUrl != "" {
		s.base = req.BaseUrl
	}
	if s.base == "" {
		switch s.engine {
		case EngineOpenAI:
			s.base = "https://api.openai.com/v1"
		case EngineAnthropic:
			s.base = "https://api.anthropic.com"
		case EngineOllama:
			s.base = "http://127.0.0.1:11434"
		}
	}
	s.base = strings.TrimRight(s.base, "/")
	if s.model == "" {
		if s.engine == EngineAnthropic {
			s.model = "claude-haiku-5-5"
		}
		if s.engine == EngineOpenAI && baseHost(s.base) == "api.openai.com" {
			s.model = "gpt-5.5"
		}
	}
	return s
}

func baseHost(base string) string {
	u, err := url.Parse(base)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

func localBase(base string) bool {
	switch baseHost(base) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}

// commandai:includeoutput only sets the default for the sheet's "Include output"
// checkbox; the request carries output only when that box is checked.
func prepare(ctx context.Context, req wshrpc.CommandAiRequest) wshrpc.CommandAiRequest {
	req = fillBlockContext(ctx, req)
	if req.Task == "" {
		req.Task = TaskCompose
	}
	return req
}

func disabledDetail(s settings, conn string) string {
	if !s.config.Settings.TermCommandComposer {
		return "Command AI is off."
	}
	if config, ok := s.config.Connections[conn]; ok && config.TermCommandComposer != nil && !*config.TermCommandComposer {
		return "Command AI is off for this host."
	}
	return ""
}

func Preview(ctx context.Context, req wshrpc.CommandAiRequest) (wshrpc.CommandAiPreview, error) {
	s := resolveSettings(req)
	req = prepare(ctx, req)
	if disabledDetail(s, req.Context.Connection) == "" {
		req = fillDistro(ctx, req)
	}
	system, message, count := buildPrompt(req)
	destination := ""
	switch s.engine {
	case EngineCodex:
		destination = "Codex on this computer, using your ChatGPT sign-in"
		info := detectOne(ctx, s, false)
		if info.Account == "API key" {
			destination = "Codex on this computer, using your Codex API key"
		}
	case EngineClaude:
		destination = "Claude Code on this computer, using your Claude sign-in"
	case EngineOllama:
		if u, err := url.Parse(s.base); err == nil {
			destination = "Ollama at " + u.Host
			if localBase(s.base) {
				destination += ", on this computer"
			}
		}
	default:
		if u, err := url.Parse(s.base); err == nil {
			destination = u.Host
		}
	}
	return wshrpc.CommandAiPreview{Engine: s.engine, EngineLabel: engineLabel(s.engine), Destination: destination, System: system, Message: message, Redactions: count}, nil
}

func registerRequest(id string, cancel context.CancelFunc) *activeRequest {
	activeRequests.Lock()
	defer activeRequests.Unlock()
	entry := &activeRequest{cancel}
	if prev := activeRequests.entries[id]; prev != nil {
		prev.cancel()
	}
	activeRequests.entries[id] = entry
	return entry
}

func unregisterRequest(id string, entry *activeRequest) {
	activeRequests.Lock()
	defer activeRequests.Unlock()
	if activeRequests.entries[id] == entry {
		delete(activeRequests.entries, id)
	}
}

func Cancel(requestId string) {
	activeRequests.Lock()
	defer activeRequests.Unlock()
	if entry := activeRequests.entries[requestId]; entry != nil {
		entry.cancel()
	}
}

func Run(ctx context.Context, req wshrpc.CommandAiRequest) (result wshrpc.CommandAiResult) {
	started := time.Now()
	s := resolveSettings(req)
	result = wshrpc.CommandAiResult{RequestId: req.RequestId, Engine: s.engine, EngineLabel: engineLabel(s.engine), Model: s.model}
	defer func() { result.DurationMs = time.Since(started).Milliseconds() }()
	timeout := apiTimeout
	if s.engine == EngineCodex || s.engine == EngineClaude {
		timeout = cliTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if req.RequestId != "" {
		entry := registerRequest(req.RequestId, cancel)
		defer unregisterRequest(req.RequestId, entry)
	}
	req = prepare(ctx, req)
	if detail := disabledDetail(s, req.Context.Connection); detail != "" {
		result.Status = StatusDisabled
		result.StatusDetail = detail
		return
	}
	if s.engine == "" {
		result.Status = StatusNotConfigured
		return
	}
	req = fillDistro(ctx, req)
	system, message, count := buildPrompt(req)
	result.Redactions = count
	if req.Task != TaskCompose && req.Task != TaskFix && req.Task != TaskExplain {
		result.Status = StatusFailed
		result.StatusDetail = "Unknown Command AI task."
		return
	}
	var e engine
	switch s.engine {
	case EngineCodex:
		e = codexEngine{}
	case EngineClaude:
		e = claudeEngine{}
	case EngineOpenAI, EngineOllama:
		e = openaiEngine{}
	case EngineAnthropic:
		e = anthropicEngine{}
	default:
		result.Status = StatusNotConfigured
		result.StatusDetail = "Choose an engine in Settings → Command AI."
		return
	}
	var err error
	if s.engine == EngineOllama && s.model == "" {
		var models []string
		models, err = fetchModels(ctx, s)
		if err == nil && len(models) > 0 {
			s.model = models[0]
		}
	}
	result.Model = s.model
	if err == nil && (s.engine == EngineOpenAI || s.engine == EngineOllama) && s.model == "" {
		err = &engineError{status: StatusNotConfigured, detail: "Choose a model in Settings → Command AI."}
	}
	var raw string
	if err == nil {
		raw, err = e.run(ctx, s, system, message)
	}
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil {
		result.Status = StatusFailed
		result.StatusDetail = engineLabel(s.engine) + " could not complete the request."
		var ee *engineError
		switch {
		case errors.Is(err, context.Canceled):
			result.Status = StatusCanceled
			result.StatusDetail = ""
		case errors.Is(err, context.DeadlineExceeded):
			result.Status = StatusTimeout
			result.StatusDetail = engineLabel(s.engine) + " took too long to answer."
		case errors.As(err, &ee):
			result.Status = ee.status
			result.StatusDetail = ee.detail
			result.FixCommand = ee.fix
		}
		return
	}
	result.Summary, result.Proposals = parseResponse(raw, req.Task)
	result.Status = StatusOk
	if len(result.Proposals) == 0 && result.Summary == "" {
		result.Status = StatusEmpty
	}
	return
}

func ListModels(ctx context.Context, req wshrpc.CommandAiModelsRequest) wshrpc.CommandAiModels {
	s := resolveSettings(wshrpc.CommandAiRequest{Engine: req.Engine, BaseUrl: req.BaseUrl})
	ctx, cancel := context.WithTimeout(ctx, apiTimeout)
	defer cancel()
	models, err := fetchModels(ctx, s)
	result := wshrpc.CommandAiModels{Models: models}
	if models == nil {
		result.Models = []string{}
	}
	if err != nil {
		result.Error = "Could not list models."
		var ee *engineError
		if errors.As(err, &ee) {
			result.Error = ee.detail
		}
	}
	return result
}
