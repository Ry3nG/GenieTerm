// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"slices"
	"strings"
	"testing"
)

func TestRootCommandPublicIdentity(t *testing.T) {
	if rootCmd.Use != "genie" {
		t.Fatalf("root Use = %q, want genie", rootCmd.Use)
	}
	if !slices.Contains(rootCmd.Aliases, "wsh") {
		t.Fatalf("root aliases = %v, want wsh compatibility alias", rootCmd.Aliases)
	}
	if !strings.Contains(rootCmd.Long, "wsh") {
		t.Fatalf("root long help should mention wsh compatibility: %q", rootCmd.Long)
	}
}
