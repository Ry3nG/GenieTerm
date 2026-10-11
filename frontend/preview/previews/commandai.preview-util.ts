// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

export function makeMockCommandAiStatus(engine: string, secrets: Record<string, string> = {}): CommandAiStatus {
    const hasOpenAiKey = secrets["COMMANDAI_OPENAI_KEY"] != null;
    const hasAnthropicKey = secrets["COMMANDAI_ANTHROPIC_KEY"] != null;
    const engines: CommandAiEngineInfo[] = [
        {
            id: "codex",
            label: "Codex",
            kind: "cli",
            available: true,
            signedin: true,
            account: "ChatGPT",
            version: "0.162.1",
        },
        {
            id: "claude",
            label: "Claude Code",
            kind: "cli",
            available: true,
            signedin: true,
            account: "Claude Pro",
            version: "2.1.295",
        },
        {
            id: "ollama",
            label: "Ollama",
            kind: "local",
            available: false,
            signedin: false,
            detail: "Not running",
            fixcommand: "ollama serve",
        },
        {
            id: "openai",
            label: "OpenAI-compatible API",
            kind: "api",
            available: hasOpenAiKey,
            signedin: hasOpenAiKey,
            needskey: true,
            haskey: hasOpenAiKey,
            defaultmodel: "gpt-5.5",
            baseurl: "https://api.openai.com/v1",
        },
        {
            id: "anthropic",
            label: "Anthropic API",
            kind: "api",
            available: hasAnthropicKey,
            signedin: hasAnthropicKey,
            needskey: true,
            haskey: hasAnthropicKey,
            defaultmodel: "claude-haiku-5-5",
        },
    ];
    const selected = engines.find((e) => e.id === engine);
    return {
        enabled: true,
        engine: engine || "",
        ready: selected != null && selected.available && selected.signedin,
        engines,
    };
}
