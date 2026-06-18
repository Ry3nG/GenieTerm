// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"strings"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
)

func TestIsWshVersionUpToDateRequiresGeniePrimaryHelper(t *testing.T) {
	oldVersion := wavebase.WaveVersion
	t.Cleanup(func() {
		wavebase.WaveVersion = oldVersion
	})
	wavebase.WaveVersion = "0.4.0"

	ok, version, osArch, err := IsWshVersionUpToDate(context.Background(), "genie v0.4.0")
	if err != nil {
		t.Fatalf("genie version check returned error: %v", err)
	}
	if !ok || version != "v0.4.0" || osArch != "" {
		t.Fatalf("genie current version returned ok=%v version=%q osArch=%q", ok, version, osArch)
	}

	ok, version, osArch, err = IsWshVersionUpToDate(context.Background(), "wsh v0.4.0")
	if err != nil {
		t.Fatalf("wsh fallback version check returned error: %v", err)
	}
	if ok || version != "v0.4.0" || osArch != "" {
		t.Fatalf("wsh fallback should require genie install, got ok=%v version=%q osArch=%q", ok, version, osArch)
	}
}

func TestMakeConnServerCommandPrefersGenieWithWshFallback(t *testing.T) {
	cmd := MakeConnServerCommand(
		wavebase.RemoteFullGenieBinPath,
		wavebase.RemoteFullWshBinPath,
		"prod-east",
		"--dev",
		"--router-domainsocket",
	)

	if !strings.Contains(cmd, wavebase.RemoteFullGenieBinPath) {
		t.Fatalf("command does not contain genie primary path: %s", cmd)
	}
	if !strings.Contains(cmd, wavebase.RemoteFullWshBinPath) {
		t.Fatalf("command does not contain wsh fallback path: %s", cmd)
	}
	if strings.Index(cmd, wavebase.RemoteFullGenieBinPath) > strings.Index(cmd, wavebase.RemoteFullWshBinPath) {
		t.Fatalf("command should prefer genie before wsh fallback: %s", cmd)
	}
	if !strings.Contains(cmd, "connserver --conn prod-east --dev --router-domainsocket") {
		t.Fatalf("command does not preserve connserver arguments: %s", cmd)
	}
}
