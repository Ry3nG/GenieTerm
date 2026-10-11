<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Command AI

Command AI turns a request into shell commands, explains why a command failed, and explains what a command does. GenieTerm has no AI service of its own. Each request goes from the user's computer to an engine they chose, and only when they ask. GenieTerm never runs a proposed command: the user inserts it at the prompt, runs it, or copies it.

## Engines

| Engine                | Id          | How it runs                                                                             |
| --------------------- | ----------- | --------------------------------------------------------------------------------------- |
| Codex                 | `codex`     | The user's `codex` CLI and its sign-in (`codex exec`)                                   |
| Claude Code           | `claude`    | The user's `claude` CLI and its sign-in (`claude -p`)                                   |
| Ollama                | `ollama`    | Ollama's OpenAI-compatible API, by default at `http://127.0.0.1:11434`                  |
| OpenAI-compatible API | `openai`    | `POST <base>/chat/completions`: OpenAI, OpenRouter, Gemini, LM Studio, vLLM and similar |
| Anthropic API         | `anthropic` | `POST <base>/v1/messages`, with a forced tool call for the structured answer            |

Nothing is chosen by default. Until `commandai:engine` is set, the sheet shows a setup screen that lists the tools found on this computer, and a run returns `notconfigured`.

The CLI engines are locked down so a request can only produce text:

- `codex exec --sandbox read-only --ephemeral --skip-git-repo-check --ignore-rules -C <empty temp dir>`, with the shell tool, apps, plugins, browser and computer use turned off through `-c features.<name>=false`, MCP servers cleared, low reasoning effort, and `--output-schema`.
- `claude -p --restricted --tools "" --strict-mcp-config --no-session-persistence --system-prompt <ours> --json-schema <schema>`, with low effort except for Haiku models. `--bare` isn't used because it disables the user's subscription sign-in.
- The prompt goes in on stdin, never in argv, where other local users could read it. Each CLI runs in its own process group, so cancelling or timing out (90 s) kills the whole tree. Output is capped at 1 MB, and the temp directory is removed afterwards.

CLI errors are matched against known kinds (signed out, usage limit, network). Only fixed messages are shown, because CLI output can echo the prompt.

The macOS app inherits a minimal `PATH` from launchd, so `shellpath.go` resolves the user's login-shell `PATH` once (`$SHELL -ilc`, 4 s limit) and adds common install locations such as Homebrew, `~/.local/bin` and nvm.

API keys live in the system keychain through `pkg/secretstore`, never in `settings.json`. Each endpoint has its own key: `COMMANDAI_OPENAI_KEY` for api.openai.com, `COMMANDAI_ANTHROPIC_KEY` for api.anthropic.com, and `COMMANDAI_KEY_<HOST>` for anything else (for example `COMMANDAI_KEY_OPENROUTER_AI`). Pointing the engine at another server therefore never sends it a key saved for a different one. On Linux without a keyring (`basic_text`), the settings page refuses to store a key.

## Request flow

```
Command AI sheet ──CommandAiRunCommand──► wavesrv: pkg/commandai
  (frontend: the                           fill shell, OS, cwd from the block
   prompt, recent                          check the off switches
   commands, the                           look up the distribution (cached)
   failed command                          sanitize → redact → cap → build the prompt
   and its output)                         run the engine ──► parse and validate
                    ◄── proposals, summary, status ─────────┘
```

The frontend sends what only it knows: the request, recent commands, and for Fix and Explain the command, its exit code, and the tail of its output (at most 120 lines). The server fills the shell type, version and `uname` from the block's runtime info, and the cwd from block metadata. It adds the distribution: `sw_vers` on macOS, `/etc/os-release` on Linux, read over the helper for remote hosts. The connection name and hostname are never sent, only "This computer", "Remote host over SSH" or "WSL".

Before anything leaves the machine, every piece of terminal text is:

1. **Sanitized**: CSI, OSC, DCS and other escape sequences, C0 and C1 controls, and progress-bar carriage returns are removed.
2. **Redacted** (`redact.go`): private keys, AWS, GitHub, OpenAI, Anthropic, Slack, Google and Stripe keys, JWTs, `Authorization` headers, credentials in URLs, `--password`-style flags, and values of variables whose names mark them as secret are replaced with `[REDACTED]`. `PWD=` is left alone.
3. **Capped**: the request at 2,000 characters, output at its last 120 lines and 8,000 characters, the selection at 4,000, recent commands at 8, and earlier turns at 4.
4. **Fenced**: terminal text goes inside `<terminal_output>`, `<selection>`, `<recent_commands>` and `<command>` tags. Closing tags inside the data are broken up, and the instructions say to treat tagged text as data.

`CommandAiPreviewCommand` runs the same builder and returns the exact system prompt and message. The sheet shows it under "What's sent".

The answer is JSON (`{"summary", "proposals": [{"command", "explanation"}]}`), validated in `parse.go`. The parser also accepts fenced JSON, bare arrays and, for compose only, plain command lines. Commands lose control and format characters, a leading `$ `, and wrapping backticks. They are de-duplicated and capped at three.

## Safety in the frontend

`frontend/app/view/term/command-risk.ts` classifies every proposal locally, without asking the model. It first canonicalizes the command: it removes quotes and escapes (`\rm`, `r''m`, `/bin/rm`), NFKC-normalizes full-width letters, and strips zero-width and bidi characters. It also unwraps `sudo`, `env`, `nice`, `timeout`, `xargs`, `nohup` and `command`, and parses nested `sh -c`, `eval`, `$(…)`, backticks, `<(…)` and `find -exec`. Each segment of a pipeline or list is then classified:

- **danger**: deleting files, erasing disks, running as administrator, piping a download into a shell, force-pushing, `git reset --hard`, destructive SQL, deleting cloud or container resources, recursive permission changes, killing processes, shutting down, and writing to system files or block devices.
- **caution**: writing files, using the network, installing software, running a downloaded package, changing a repository, services or system settings.

Inserting a command only types it at the prompt, so it never asks first. Running a danger command, or one that contains hidden characters, needs a second confirmation. A multi-line command is copied instead of inserted when the shell hasn't turned on bracketed paste, because each newline would run a line.

## Surfaces

- **The sheet** (`command-composer-ui.tsx`, state in `term-commandai.ts`): opened with ⌘⇧Space (Alt+Shift+Space on Linux and Windows), the header's sparkle button, or the command palette. A request typed at the prompt is carried into the sheet. Follow-up requests refine the answer, with earlier turns sent as `previous`. Keys: ↑↓ select, ↵ insert, ⌘↵ run, esc cancel or close.
- **Fix and Explain**: the sparkle button on the command action bar opens Fix for a failed command and Explain for any other finished one. "Explain Selection with AI" is in the terminal's context menu. The sheet's "Include output" checkbox defaults to `commandai:includeoutput`. Unchecking it asks again without the output.
- **Inline suggestion**: when something that reads like a request (for example "show disk usage") fails with exit code 127, a one-line suggestion appears under the terminal. This happens only once an engine is chosen, and only while `commandai:inline` is on.

## Settings

| Key                       | Default | Meaning                                                                       |
| ------------------------- | ------- | ----------------------------------------------------------------------------- |
| `term:commandcomposer`    | `true`  | Master switch. In `connections.json`, `false` turns Command AI off for a host |
| `commandai:engine`        | unset   | `codex`, `claude`, `ollama`, `openai` or `anthropic`                          |
| `commandai:model`         | unset   | Model name. Empty uses the engine's default                                   |
| `commandai:baseurl`       | unset   | Endpoint for `openai`, `ollama` and `anthropic`                               |
| `commandai:includeoutput` | `true`  | Whether Fix and Explain include output by default                             |
| `commandai:inline`        | `true`  | Suggest a command when a typed request fails as a command                     |

Settings → Command AI edits all of these, stores API keys, and has a test button. Choosing a different engine clears the model and endpoint.

## Code map

| Path                                                | Contents                                        |
| --------------------------------------------------- | ----------------------------------------------- |
| `pkg/commandai/`                                    | Engines, detection, prompt, redaction, parsing  |
| `pkg/wshrpc/wshrpctypes.go`                         | `CommandAi*` RPC types                          |
| `frontend/app/store/commandai.ts`                   | `CommandAiClient`: status, run, preview, cancel |
| `frontend/app/view/term/term-commandai.ts`          | Per-terminal sheet and inline state             |
| `frontend/app/view/term/command-composer*.ts(x)`    | Context building, proposals, the sheet UI       |
| `frontend/app/view/term/command-risk.ts`            | Local risk classifier                           |
| `frontend/app/view/waveconfig/commandaicontent.tsx` | Settings → Command AI                           |
| `frontend/preview/previews/commandai.preview.tsx`   | Every sheet state, for visual QA                |

Tests: `go test ./pkg/commandai/` covers fake CLIs, `httptest` servers for every API, redaction, sanitizing, prompt goldens and cancellation. `GENIETERM_COMMANDAI_E2E=1` runs one real request through each installed, signed-in CLI. The frontend tests are `command-risk.test.ts`, `command-composer.test.ts` and `term-commandai.test.ts`.
