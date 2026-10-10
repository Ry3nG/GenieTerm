// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package portforward

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

type fakeDialer struct {
	dial   func(string, string) (net.Conn, error)
	close  func()
	closed atomic.Int32
}

func (d *fakeDialer) Dial(network, address string) (net.Conn, error) { return d.dial(network, address) }
func (d *fakeDialer) Close() error {
	if d.closed.Add(1) == 1 && d.close != nil {
		d.close()
	}
	return nil
}

type clientState struct{ client atomic.Pointer[fakeDialer] }

func (s *clientState) lookup(string) Dialer {
	if d := s.client.Load(); d != nil {
		return d
	}
	return nil
}

func makeTestManager(t *testing.T, state *clientState) *Manager {
	t.Helper()
	m := MakeManager(state.lookup, func(string, []wshrpc.PortForwardInfo) {})
	t.Cleanup(m.CloseAll)
	return m
}

func waitFor(t *testing.T, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !fn() {
		if time.Now().After(deadline) {
			t.Fatal("condition did not become true")
		}
		time.Sleep(time.Millisecond)
	}
}

func listenTest(t *testing.T) net.Listener {
	t.Helper()
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	return l
}

func makeEcho(t *testing.T) (int, *fakeDialer) {
	t.Helper()
	l := listenTest(t)
	var wg sync.WaitGroup
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer c.Close()
				c.SetDeadline(time.Now().Add(5 * time.Second))
				io.Copy(c, c)
			}()
		}
	}()
	t.Cleanup(func() { l.Close(); <-finished; wg.Wait() })
	return l.Addr().(*net.TCPAddr).Port, &fakeDialer{dial: func(network, address string) (net.Conn, error) {
		return net.DialTimeout(network, address, time.Second)
	}}
}

func startTest(t *testing.T, m *Manager, port int) *wshrpc.PortForwardInfo {
	t.Helper()
	f, err := m.Start(context.Background(), wshrpc.CommandPortForwardStartData{ConnName: "test-host", RemotePort: port})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func connectTest(t *testing.T, f *wshrpc.PortForwardInfo) net.Conn {
	t.Helper()
	c, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(f.LocalPort)), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	c.SetDeadline(time.Now().Add(3 * time.Second))
	t.Cleanup(func() { c.Close() })
	return c
}

func assertClosed(t *testing.T, c net.Conn) {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(time.Second))
	_, err := c.Read(make([]byte, 1))
	if err == nil {
		t.Fatal("connection is still open")
	}
	if nerr, ok := err.(net.Error); ok && nerr.Timeout() {
		t.Fatalf("connection did not close: %v", err)
	}
}

func echoTest(t *testing.T, c net.Conn) {
	t.Helper()
	payload := bytes.Repeat([]byte("forwarded data\x00"), 8192)
	written := make(chan error, 1)
	go func() { _, err := c.Write(payload); written <- err }()
	got := make([]byte, len(payload))
	_, err := io.ReadFull(c, got)
	writeErr := <-written
	if err != nil || writeErr != nil {
		t.Fatalf("echo: read=%v write=%v", err, writeErr)
	}
	if !bytes.Equal(got, payload) {
		t.Fatal("echo data differs")
	}
}

func TestValidateStart(t *testing.T) {
	for _, tc := range []struct {
		name          string
		conn          string
		host          string
		remote, local int
		err           string
	}{
		{"defaults", "user@host:2222", "", 80, 0, ""},
		{"limits", "host", "example.com", 65535, 65535, ""},
		{"ipv6", "host", "::1", 1, 1, ""},
		{"empty", "", "", 80, 0, sshOnlyError},
		{"local", "local", "", 80, 0, sshOnlyError},
		{"local named", "local:abc", "", 80, 0, sshOnlyError},
		{"wsl", "wsl://Ubuntu", "", 80, 0, sshOnlyError},
		{"invalid conn", "bad host", "", 80, 0, "invalid SSH connection name"},
		{"remote zero", "host", "", 0, 0, "remote port must"},
		{"remote negative", "host", "", -1, 0, "remote port must"},
		{"remote large", "host", "", 65536, 0, "remote port must"},
		{"local negative", "host", "", 80, -1, "local port must"},
		{"local large", "host", "", 80, 65536, "local port must"},
		{"host newline", "host", "foo\nbar", 80, 0, "invalid remote host"},
		{"host URL", "host", "http://localhost", 80, 0, "invalid remote host"},
		{"host bracketed", "host", "[::1]", 80, 0, "invalid remote host"},
		{"host oversized", "host", strings.Repeat("a", 254), 80, 0, "invalid remote host"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, err := validateStart(wshrpc.CommandPortForwardStartData{ConnName: tc.conn, RemoteHost: tc.host, RemotePort: tc.remote, LocalPort: tc.local})
			if tc.err != "" {
				if err == nil || !strings.Contains(err.Error(), tc.err) {
					t.Fatalf("expected %q, got %v", tc.err, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if tc.host == "" && data.RemoteHost != "127.0.0.1" {
				t.Fatal("missing default remote host")
			}
		})
	}
}

func TestPortChoice(t *testing.T) {
	for _, mode := range []string{"fallback", "explicit busy", "preferred", "explicit free"} {
		t.Run(mode, func(t *testing.T) {
			busy := listenTest(t)
			port := busy.Addr().(*net.TCPAddr).Port
			m := makeTestManager(t, &clientState{})
			data := wshrpc.CommandPortForwardStartData{ConnName: "host", RemotePort: port}
			if strings.HasPrefix(mode, "explicit") {
				data.LocalPort = port
			}
			if mode == "preferred" || mode == "explicit free" {
				busy.Close()
			}
			f, err := m.Start(context.Background(), data)
			if mode == "explicit busy" {
				if err == nil || err.Error() != fmt.Sprintf("local port %d is in use", port) {
					t.Fatalf("busy error: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if mode == "fallback" && f.LocalPort == port {
				t.Fatal("did not fall back")
			}
			if mode != "fallback" && f.LocalPort != port {
				t.Fatal("did not use requested port")
			}
			m.lock.Lock()
			defer m.lock.Unlock()
			if addr := m.forwards[f.Id].listener.Addr().(*net.TCPAddr); !addr.IP.Equal(net.IPv4(127, 0, 0, 1)) {
				t.Fatalf("unsafe listen address: %v", addr)
			}
		})
	}
}

func TestRelayLifecycle(t *testing.T) {
	for _, mode := range []string{"stop", "local close", "shutdown", "reconnect"} {
		t.Run(mode, func(t *testing.T) {
			port, d := makeEcho(t)
			state := &clientState{}
			state.client.Store(d)
			m := makeTestManager(t, state)
			f := startTest(t, m, port)
			c := connectTest(t, f)
			echoTest(t, c)
			waitFor(t, func() bool { return m.List("")[0].ActiveConns == 1 })
			switch mode {
			case "stop":
				m.Stop(f.Id)
				assertClosed(t, c)
			case "local close":
				c.Close()
			case "shutdown":
				m.CloseAll()
				assertClosed(t, c)
			case "reconnect":
				state.client.Store(nil)
				m.Refresh(f.ConnName)
				if m.List("")[0].Status != wshrpc.PortForwardStatus_Waiting {
					t.Fatal("not waiting after disconnect")
				}
				assertClosed(t, c)
				d2 := &fakeDialer{dial: d.dial}
				state.client.Store(d2)
				m.Refresh(f.ConnName)
				if m.List("")[0].Status != wshrpc.PortForwardStatus_Active {
					t.Fatal("not active after reconnect")
				}
				c2 := connectTest(t, f)
				echoTest(t, c2)
				c2.Close()
			}
			waitFor(t, func() bool {
				m.lock.Lock()
				defer m.lock.Unlock()
				return m.sessionCount == 0 && m.dialCount == 0
			})
			if mode != "shutdown" && d.closed.Load() != 0 {
				t.Fatal("shared SSH client was closed")
			}
		})
	}
}

func TestMemoryList(t *testing.T) {
	m := makeMemoryManager(t, &clientState{}, nil)
	for _, data := range []wshrpc.CommandPortForwardStartData{
		{ConnName: "z", RemotePort: 44223}, {ConnName: "a", RemotePort: 44222},
		{ConnName: "a", RemotePort: 44221}, {ConnName: "a", RemoteHost: "example.org", RemotePort: 44221},
	} {
		if _, err := m.Start(context.Background(), data); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		name  string
		count int
	}{{"", 4}, {"a", 3}, {"z", 1}, {"missing", 0}} {
		t.Run(tc.name, func(t *testing.T) {
			list := m.List(tc.name)
			if list == nil || len(list) != tc.count {
				t.Fatalf("unexpected list: %v", list)
			}
			for i := 1; i < len(list); i++ {
				if list[i-1].ConnName > list[i].ConnName || (list[i-1].ConnName == list[i].ConnName && list[i-1].RemotePort > list[i].RemotePort) {
					t.Fatal("unsorted list")
				}
			}
		})
	}
}
