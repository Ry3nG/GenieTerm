// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

// Package commandai turns a request into shell-command proposals using an engine
// the user already has: a signed-in agent CLI, a local model, or their own API key.
// It never runs a proposed command.
package commandai

import (
	"context"

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

func GetStatus(ctx context.Context, refresh bool) wshrpc.CommandAiStatus {
	return wshrpc.CommandAiStatus{}
}

func ListModels(ctx context.Context, req wshrpc.CommandAiModelsRequest) wshrpc.CommandAiModels {
	return wshrpc.CommandAiModels{}
}

func Preview(ctx context.Context, req wshrpc.CommandAiRequest) (wshrpc.CommandAiPreview, error) {
	return wshrpc.CommandAiPreview{}, nil
}

func Run(ctx context.Context, req wshrpc.CommandAiRequest) wshrpc.CommandAiResult {
	return wshrpc.CommandAiResult{RequestId: req.RequestId, Status: StatusNotConfigured}
}

func Cancel(requestId string) {
}
