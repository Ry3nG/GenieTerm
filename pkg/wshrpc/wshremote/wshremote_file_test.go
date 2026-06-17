// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func TestRouteForFileSourceHostUsesDefaultRouteForLocalFileSource(t *testing.T) {
	t.Parallel()

	if got := routeForFileSourceHost(""); got != wshutil.DefaultRoute {
		t.Fatalf("expected local file source route to be %q, got %q", wshutil.DefaultRoute, got)
	}

	host := "zrgong@paw-5090-ws"
	expected := wshutil.MakeConnectionRouteId(host)
	if got := routeForFileSourceHost(host); got != expected {
		t.Fatalf("expected remote file source route to be %q, got %q", expected, got)
	}
}
