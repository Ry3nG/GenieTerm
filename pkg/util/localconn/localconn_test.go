// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package localconn

import (
	"io"
	"net"
	"testing"
	"time"
)

func connectPair(t *testing.T, listener net.Listener, socketPath string) (net.Conn, net.Conn) {
	t.Helper()
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, _ := listener.Accept()
		accepted <- conn
	}()
	client, err := Dial(socketPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	var server net.Conn
	select {
	case server = <-accepted:
		if server == nil {
			t.Fatal("listener did not accept the connection")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("accept timed out")
	}
	t.Cleanup(func() { server.Close() })
	client.SetDeadline(time.Now().Add(3 * time.Second))
	server.SetDeadline(time.Now().Add(3 * time.Second))
	return client, server
}

func assertRoundTrip(t *testing.T, client, server net.Conn, message string) {
	t.Helper()
	if _, err := client.Write([]byte(message)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(message))
	if _, err := io.ReadFull(server, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != message {
		t.Fatalf("message = %q, want %q", buf, message)
	}
	if _, err := server.Write(buf); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(client, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != message {
		t.Fatalf("reply = %q, want %q", buf, message)
	}
}
