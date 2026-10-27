// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows/registry"
)

func TestWindowsHostInfoNative(t *testing.T) {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DESCRIPTION\System\CentralProcessor\0`, registry.QUERY_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	defer key.Close()
	model, _, err := key.GetStringValue("ProcessorNameString")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	info := collectHostInfo(ctx)
	if strings.TrimSpace(info.CpuModel) != strings.TrimSpace(model) || info.CpuModel == "" {
		t.Fatalf("CPU model = %q, registry = %q", info.CpuModel, model)
	}
	if !strings.Contains(info.Os, "Windows") || info.Os == "windows" {
		t.Fatalf("OS product/version missing: %+v", info)
	}
	osKey, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		t.Fatal(err)
	}
	defer osKey.Close()
	if version, _, err := osKey.GetStringValue("DisplayVersion"); err == nil && version != "" && !strings.Contains(info.Os, version) {
		t.Fatalf("OS %q lacks native display version %q", info.Os, version)
	}
	t.Logf("native host: OS=%q CPU=%q kernel=%q logical CPUs=%d", info.Os, info.CpuModel, info.Kernel, info.NumCpu)
}
