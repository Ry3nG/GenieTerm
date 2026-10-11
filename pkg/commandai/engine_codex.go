// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"io"
	"os"
	"path/filepath"
)

func codexArgs(dir, model string) []string {
	args := []string{"exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-rules", "-C", dir, "-c", `model_reasoning_effort="low"`, "-c", "mcp_servers={}", "-c", "features.shell_tool=false", "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.browser_use=false", "-c", "features.computer_use=false", "--output-schema", filepath.Join(dir, "schema.json"), "-o", filepath.Join(dir, "out.json")}
	if model != "" {
		args = append(args, "-m", model)
	}
	return append(args, "-")
}

type codexEngine struct{}

func (codexEngine) run(ctx context.Context, s settings, system, message string) (string, error) {
	path, err := lookPath(EngineCodex)
	if err != nil {
		return "", cliMissing(EngineCodex)
	}
	dir, err := os.MkdirTemp("", "genieterm-commandai-")
	if err != nil {
		return "", failure("Could not prepare Codex.")
	}
	defer os.RemoveAll(dir)
	if err = os.WriteFile(filepath.Join(dir, "schema.json"), []byte(responseSchema), 0600); err != nil {
		return "", failure("Could not prepare Codex.")
	}
	out, stderr, err := runProcess(ctx, path, codexArgs(dir, s.model), dir, system+"\n\n"+message, childEnv())
	if err != nil {
		return "", cliError(ctx, EngineCodex, out, stderr)
	}
	f, err := os.Open(filepath.Join(dir, "out.json"))
	if err != nil {
		return "", failure("Codex returned no response.")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, processOutputLimit+1))
	if err != nil || len(data) > processOutputLimit {
		return "", failure("Codex response could not be read.")
	}
	return string(data), nil
}
