// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/util/localconn"
	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
)

func TestDomainSocketDialPreservesLocalAndRemoteTransports(t *testing.T) {
	directory, err := os.MkdirTemp("", "g-sock-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(directory) })
	for _, name := range []string{wavebase.DomainSocketBaseName, wavebase.RemoteDomainSocketBaseName, wavebase.LegacyRemoteDomainSocketBaseName, "forwarded.sock"} {
		t.Run(name, func(t *testing.T) {
			socketPath := filepath.Join(directory, name)
			var listener net.Listener
			var err error
			if name == wavebase.DomainSocketBaseName {
				listener, err = localconn.Listen(socketPath)
			} else {
				listener, err = net.Listen("unix", socketPath)
			}
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { listener.Close() })
			accepted := make(chan error, 1)
			go func() {
				conn, err := listener.Accept()
				if err == nil {
					conn.SetDeadline(time.Now().Add(3 * time.Second))
					_, err = conn.Write([]byte(name))
					conn.Close()
				}
				accepted <- err
			}()
			client, err := DialDomainSocket(socketPath)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			client.SetDeadline(time.Now().Add(3 * time.Second))
			data := make([]byte, len(name))
			if _, err := io.ReadFull(client, data); err != nil || string(data) != name {
				t.Fatalf("read from %s: %q (%v)", name, data, err)
			}
			if err := <-accepted; err != nil {
				t.Fatal(err)
			}
		})
	}
}
