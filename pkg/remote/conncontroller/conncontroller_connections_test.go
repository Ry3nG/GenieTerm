// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
)

func TestResolveSshConfigPatternsReadsAvailableConfigWhenAnotherIsMissing(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(configPath, []byte("Host devbox\n    HostName 192.0.2.10\n"), 0600); err != nil {
		t.Fatalf("failed to write test SSH config: %v", err)
	}

	patterns, err := resolveSshConfigPatterns([]string{configPath, filepath.Join(t.TempDir(), "missing")})
	if err != nil {
		t.Fatalf("resolveSshConfigPatterns returned an error: %v", err)
	}

	expected := remote.NormalizeConfigPattern("devbox")
	if len(patterns) != 1 || patterns[0] != expected {
		t.Fatalf("expected one normalized host %q, got %v", expected, patterns)
	}
}
