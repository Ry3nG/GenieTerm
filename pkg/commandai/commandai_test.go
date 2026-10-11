// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func testConfig(t *testing.T, engine string) *wconfig.FullConfigType {
	t.Helper()
	oldConfig, oldSecret, oldDistro := getConfig, getSecret, fetchDistro
	config := &wconfig.FullConfigType{Settings: wconfig.SettingsType{TermCommandComposer: true, CommandAiEngine: engine}}
	getConfig = func() wconfig.FullConfigType { return *config }
	getSecret = func(string) (string, bool, error) { return "", false, nil }
	fetchDistro = func(context.Context, string) string { return "" }
	t.Cleanup(func() { getConfig = oldConfig; getSecret = oldSecret; fetchDistro = oldDistro })
	return config
}

func TestRunSettings(t *testing.T) {
	cfg := testConfig(t, "")
	ctx := context.Background()
	if r := Run(ctx, wshrpc.CommandAiRequest{RequestId: "not-configured", Prompt: "ls"}); r.Status != StatusNotConfigured || r.RequestId != "not-configured" {
		t.Fatal(r)
	}
	cfg.Settings.TermCommandComposer = false
	if r := Run(ctx, wshrpc.CommandAiRequest{}); r.Status != StatusDisabled || r.StatusDetail != "Command AI is off." {
		t.Fatal(r)
	}
	cfg.Settings.TermCommandComposer = true
	off := false
	cfg.Connections = map[string]wconfig.ConnKeywords{"ssh-host": {TermCommandComposer: &off}}
	if r := Run(ctx, wshrpc.CommandAiRequest{Context: wshrpc.CommandAiContext{Connection: "ssh-host"}}); r.Status != StatusDisabled || r.StatusDetail != "Command AI is off for this host." {
		t.Fatal(r)
	}
	cfg.Settings.CommandAiEngine = EngineOpenAI
	cfg.Settings.CommandAiBaseUrl = "http://localhost:1234/v1"
	if r := Run(ctx, wshrpc.CommandAiRequest{}); r.Status != StatusNotConfigured || !strings.Contains(r.StatusDetail, "Choose a model") {
		t.Fatal(r)
	}
	s := resolveSettings(wshrpc.CommandAiRequest{Engine: EngineAnthropic})
	if s.base != "https://api.anthropic.com" || s.model != "claude-haiku-5-5" {
		t.Fatal(s)
	}
	cfg.Settings.CommandAiBaseUrl = "https://api.openai.com/v1"
	if s = resolveSettings(wshrpc.CommandAiRequest{}); s.model != "gpt-5.5" {
		t.Fatal(s)
	}
	cfg.Settings.CommandAiModel = "configured-model"
	if s = resolveSettings(wshrpc.CommandAiRequest{Model: "override"}); s.model != "override" {
		t.Fatal(s)
	}
}

func TestBlockContextAndDistroCache(t *testing.T) {
	cfg := testConfig(t, "")
	distroCache.Lock()
	distroCache.entries = make(map[string]distroEntry)
	distroCache.Unlock()
	oldBlock, oldRT := readBlock, readRTInfo
	t.Cleanup(func() { readBlock = oldBlock; readRTInfo = oldRT })
	readBlock = func(context.Context, string) (*waveobj.Block, error) {
		return &waveobj.Block{Meta: waveobj.MetaMapType{"connection": "cache-test-host", "cmd:cwd": "/srv/project"}}, nil
	}
	readRTInfo = func(waveobj.ORef) *waveobj.ObjRTInfo {
		return &waveobj.ObjRTInfo{ShellType: "bash", ShellVersion: "5.2", ShellUname: "Linux 6.8 x86_64"}
	}
	calls := 0
	fetchDistro = func(ctx context.Context, conn string) string {
		calls++
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 1500*time.Millisecond {
			t.Error("missing lookup timeout")
		}
		return "Debian GNU/Linux 12"
	}
	req := fillDistro(context.Background(), fillBlockContext(context.Background(), wshrpc.CommandAiRequest{BlockId: "block"}))
	want := wshrpc.CommandAiContext{Connection: "cache-test-host", Cwd: "/srv/project", Shell: "bash", ShellVersion: "5.2", Os: "Linux 6.8 x86_64", Distro: "Debian GNU/Linux 12"}
	if !reflect.DeepEqual(req.Context, want) {
		t.Fatalf("%+v", req.Context)
	}
	_ = fillDistro(context.Background(), fillBlockContext(context.Background(), wshrpc.CommandAiRequest{BlockId: "block"}))
	if calls != 1 {
		t.Fatal(calls)
	}
	off := false
	cfg.Connections = map[string]wconfig.ConnKeywords{"cache-test-host": {TermCommandComposer: &off}}
	if r := Run(context.Background(), wshrpc.CommandAiRequest{BlockId: "block"}); r.Status != StatusDisabled {
		t.Fatal(r)
	}
	provided := wshrpc.CommandAiContext{Connection: "given", Cwd: "/given", Shell: "fish", ShellVersion: "4", Os: "provided", Distro: "given"}
	req = fillDistro(context.Background(), fillBlockContext(context.Background(), wshrpc.CommandAiRequest{BlockId: "block", Context: provided}))
	if !reflect.DeepEqual(req.Context, provided) {
		t.Fatal(req)
	}
	readBlock = func(context.Context, string) (*waveobj.Block, error) { return nil, errors.New("not found") }
	readRTInfo = func(waveobj.ORef) *waveobj.ObjRTInfo { return nil }
	_ = fillDistro(context.Background(), fillBlockContext(context.Background(), wshrpc.CommandAiRequest{BlockId: "missing"}))
}

func TestRequestRegistrationReplacement(t *testing.T) {
	ctx1, cancel1 := context.WithCancel(context.Background())
	defer cancel1()
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	first := registerRequest("same", cancel1)
	second := registerRequest("same", cancel2)
	if ctx1.Err() != context.Canceled {
		t.Fatal("old request not canceled")
	}
	unregisterRequest("same", first)
	Cancel("same")
	if ctx2.Err() != context.Canceled {
		t.Fatal("new request was unregistered")
	}
	unregisterRequest("same", second)
	Cancel("unknown")
}
