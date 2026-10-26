// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"io"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
)

func TestLocalListenerUsesPipeForLongUnicodeDataHome(t *testing.T) {
	original := wavebase.DataHome_VarCache
	t.Cleanup(func() { wavebase.DataHome_VarCache = original })
	wavebase.DataHome_VarCache = filepath.Join(t.TempDir(), strings.Repeat("中文用户目录", 20), "GenieTerm Data")
	listener, err := MakeUnixListener()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	if !strings.HasPrefix(listener.Addr().String(), `\\.\pipe\genieterm-local-`) {
		t.Fatalf("long data directory did not use a named pipe: %v", listener.Addr())
	}
	done := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			conn.SetDeadline(time.Now().Add(3 * time.Second))
			_, err = conn.Write([]byte("local RPC"))
			conn.Close()
		}
		done <- err
	}()
	client, err := wshutil.DialDomainSocket(wavebase.GetDomainSocketName())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	data, err := io.ReadAll(client)
	if err != nil || string(data) != "local RPC" {
		t.Fatalf("local endpoint response = %q (%v)", data, err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
