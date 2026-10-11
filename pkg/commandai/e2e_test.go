// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestCommandAiE2E(t *testing.T) {
	if os.Getenv("GENIETERM_COMMANDAI_E2E") != "1" {
		t.Skip("set GENIETERM_COMMANDAI_E2E=1 outside the sandbox to use real signed-in CLIs")
	}
	resolvePath(true)
	for _, id := range []string{EngineCodex, EngineClaude} {
		t.Run(id, func(t *testing.T) {
			if _, err := lookPath(id); err != nil {
				t.Skip("CLI is not installed")
			}
			testConfig(t, id)
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
			defer cancel()
			req := wshrpc.CommandAiRequest{RequestId: "e2e-" + id, Task: TaskCompose, Prompt: "Find files larger than 100 MB in the current directory.", Context: wshrpc.CommandAiContext{Cwd: "/tmp", Shell: "zsh", Os: runtime.GOOS, Distro: runtime.GOOS}}
			result := Run(ctx, req)
			if result.Status != StatusOk || len(result.Proposals) == 0 {
				t.Fatalf("status=%s detail=%s", result.Status, result.StatusDetail)
			}
			t.Logf("engine=%s latency=%dms proposals=%+v", id, result.DurationMs, result.Proposals)
		})
	}
}
