// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"bytes"
	"context"
	"os/exec"
	"time"
)

const processOutputLimit = 1024 * 1024

type cappedBuffer struct{ bytes.Buffer }

func (b *cappedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	// Preserve the tail because CLI diagnostics usually follow streamed progress.
	if n >= processOutputLimit {
		b.Reset()
		_, _ = b.Buffer.Write(p[n-processOutputLimit:])
		return n, nil
	}
	if excess := b.Len() + n - processOutputLimit; excess > 0 {
		b.Next(excess)
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}

func runProcess(ctx context.Context, path string, args []string, dir, input string, env []string) ([]byte, []byte, error) {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir = dir
	cmd.Env = env
	if input != "" {
		cmd.Stdin = bytes.NewBufferString(input)
	}
	var stdout, stderr cappedBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	setupProcess(cmd)
	cmd.WaitDelay = time.Second
	err := cmd.Run()
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	return stdout.Bytes(), stderr.Bytes(), err
}
