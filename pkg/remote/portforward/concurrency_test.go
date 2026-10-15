// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package portforward

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/google/uuid"
)

type pipeListener struct {
	accepted chan net.Conn
	done     chan struct{}
	once     sync.Once
}

func (l *pipeListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.accepted:
		return c, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}
func (l *pipeListener) Close() error   { l.once.Do(func() { close(l.done) }); return nil }
func (l *pipeListener) Addr() net.Addr { return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 12345} }

type halfCloseConn struct {
	net.Conn
	halfCloses *atomic.Int32
}

// net.Pipe cannot half-close; closing stands in for an echo server that hangs up once its input ends.
func (c *halfCloseConn) CloseWrite() error { c.halfCloses.Add(1); return c.Conn.Close() }

func makeMemoryManager(t *testing.T, state *clientState, publish func(string, []wshrpc.PortForwardInfo)) *Manager {
	t.Helper()
	if publish == nil {
		publish = func(string, []wshrpc.PortForwardInfo) {}
	}
	m := MakeManager(state.lookup, publish)
	m.listen = func(wshrpc.CommandPortForwardStartData) (net.Listener, error) {
		return &pipeListener{accepted: make(chan net.Conn), done: make(chan struct{})}, nil
	}
	t.Cleanup(m.CloseAll)
	return m
}

func memoryConnect(t *testing.T, m *Manager, f *wshrpc.PortForwardInfo) net.Conn {
	t.Helper()
	l := func() *pipeListener {
		m.lock.Lock()
		defer m.lock.Unlock()
		return m.forwards[f.Id].listener.(*pipeListener)
	}()
	client, local := net.Pipe()
	select {
	case l.accepted <- local:
	case <-time.After(time.Second):
		local.Close()
		client.Close()
		t.Fatal("accept blocked")
	}
	client.SetDeadline(time.Now().Add(3 * time.Second))
	t.Cleanup(func() { client.Close() })
	return client
}

func makePipeDialer(t *testing.T) (*fakeDialer, *atomic.Int32) {
	t.Helper()
	var wg sync.WaitGroup
	halfCloses := &atomic.Int32{}
	d := &fakeDialer{dial: func(n, a string) (net.Conn, error) {
		if n != "tcp" || a != "127.0.0.1:8888" {
			t.Errorf("wrong remote target: %s %s", n, a)
		}
		aSide, bSide := net.Pipe()
		wg.Add(1)
		go func() { defer wg.Done(); defer bSide.Close(); io.Copy(bSide, bSide) }()
		return &halfCloseConn{aSide, halfCloses}, nil
	}}
	t.Cleanup(wg.Wait)
	return d, halfCloses
}

func idle(m *Manager) bool {
	m.lock.Lock()
	defer m.lock.Unlock()
	return m.sessionCount == 0 && m.dialCount == 0
}

func TestMemoryLifecycle(t *testing.T) {
	for _, mode := range []string{"stop", "shutdown", "remote closes", "local closes", "reconnect without event", "reconnect event"} {
		t.Run(mode, func(t *testing.T) {
			d, halfCloses := makePipeDialer(t)
			state := &clientState{}
			state.client.Store(d)
			var remotePeer net.Conn
			if mode == "remote closes" {
				d.dial = func(string, string) (net.Conn, error) {
					a, b := net.Pipe()
					remotePeer = b
					return a, nil
				}
			}
			m := makeMemoryManager(t, state, nil)
			f := startTest(t, m, 8888)
			c := memoryConnect(t, m, f)
			waitFor(t, func() bool { return m.List("")[0].ActiveConns == 1 })
			if mode != "remote closes" {
				echoTest(t, c)
			}
			switch mode {
			case "stop":
				m.Stop(f.Id)
				assertClosed(t, c)
			case "shutdown":
				m.CloseAll()
				assertClosed(t, c)
			case "remote closes":
				remotePeer.Close()
				assertClosed(t, c)
			case "local closes":
				c.Close()
			default:
				state.client.Store(nil)
				m.Refresh("")
				assertClosed(t, c)
				if m.List("")[0].Status != wshrpc.PortForwardStatus_Waiting {
					t.Fatal("not waiting")
				}
				c2 := memoryConnect(t, m, f)
				assertClosed(t, c2)
				state.client.Store(&fakeDialer{dial: d.dial})
				if mode == "reconnect event" {
					m.Refresh("")
				}
				c3 := memoryConnect(t, m, f)
				echoTest(t, c3)
				if m.List("")[0].Status != wshrpc.PortForwardStatus_Active {
					t.Fatal("not active")
				}
				c3.Close()
			}
			waitFor(t, func() bool { return idle(m) })
			if mode != "remote closes" && halfCloses.Load() == 0 {
				t.Fatal("CloseWrite was never used")
			}
		})
	}
}

func TestMemoryConcurrentStartStop(t *testing.T) {
	for _, mode := range []string{"same key", "stop", "shutdown"} {
		t.Run(mode, func(t *testing.T) {
			m := makeMemoryManager(t, &clientState{}, nil)
			f := startTest(t, m, 8888)
			if _, err := uuid.Parse(f.Id); err != nil {
				t.Fatal(err)
			}
			if delta := time.Now().UnixMilli() - f.CreatedTs; delta < 0 || delta > 1000 {
				t.Fatal("created timestamp must use Unix milliseconds")
			}
			var wg sync.WaitGroup
			for i := 0; i < 64; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					data := wshrpc.CommandPortForwardStartData{ConnName: f.ConnName, RemoteHost: "127.0.0.1", RemotePort: 8888, LocalPort: 9999}
					switch mode {
					case "same key":
						got, err := m.Start(context.Background(), data)
						if err != nil || got.Id != f.Id {
							t.Errorf("idempotence failed: %v %v", got, err)
						}
					case "stop":
						m.Stop(f.Id)
					case "shutdown":
						if i%2 == 0 {
							m.CloseAll()
						} else {
							m.Start(context.Background(), data)
						}
					}
					m.List("")
					m.Refresh("")
				}()
			}
			wg.Wait()
			want := 0
			if mode == "same key" {
				want = 1
			}
			if len(m.List("")) != want {
				t.Fatal("wrong list size")
			}
		})
	}
}

func TestMemoryPendingDials(t *testing.T) {
	for _, mode := range []string{"timeout", "stop", "late failure after reconnect", "dial limit", "error recovery"} {
		t.Run(mode, func(t *testing.T) {
			echo, _ := makePipeDialer(t)
			state := &clientState{}
			release := make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			var calls atomic.Int32
			var fail atomic.Bool
			fail.Store(true)
			d := &fakeDialer{close: unblock, dial: func(n, a string) (net.Conn, error) {
				calls.Add(1)
				if mode == "error recovery" {
					if fail.Load() {
						return nil, errors.New("refused")
					}
					return echo.Dial(n, a)
				}
				<-release
				if mode == "late failure after reconnect" {
					return nil, errors.New("old client error")
				}
				return echo.Dial(n, a)
			}}
			state.client.Store(d)
			m := makeMemoryManager(t, state, nil)
			m.dialTimeout = 30 * time.Millisecond
			f := startTest(t, m, 8888)
			c := memoryConnect(t, m, f)
			waitFor(t, func() bool { return calls.Load() == 1 })
			switch mode {
			case "stop":
				m.Stop(f.Id)
			case "late failure after reconnect":
				state.client.Store(echo)
				m.Refresh("")
			}
			assertClosed(t, c)
			if mode == "dial limit" {
				for i := 1; i < maxPendingDials; i++ {
					assertClosed(t, memoryConnect(t, m, f))
				}
				assertClosed(t, memoryConnect(t, m, f))
				if calls.Load() != maxPendingDials {
					t.Fatalf("pending dial bound failed: %d", calls.Load())
				}
			}
			if mode == "timeout" || mode == "error recovery" {
				if got := m.List("")[0]; got.Status != wshrpc.PortForwardStatus_Error || got.Error == "" {
					t.Fatalf("missing dial error: %+v", got)
				}
			}
			if d.closed.Load() != 0 {
				t.Fatal("shared connection was closed")
			}
			if mode == "error recovery" {
				fail.Store(false)
				c2 := memoryConnect(t, m, f)
				echoTest(t, c2)
				c2.Close()
				if got := m.List("")[0]; got.Status != wshrpc.PortForwardStatus_Active || got.Error != "" {
					t.Fatal("did not recover")
				}
			}
			if mode == "late failure after reconnect" {
				unblock()
				waitFor(t, func() bool { return idle(m) })
				if got := m.List("")[0]; got.Status != wshrpc.PortForwardStatus_Waiting || got.Error != "" {
					t.Fatalf("stale error overwrote reconnect: %+v", got)
				}
			} else {
				m.Stop(f.Id)
				m.CloseAll()
				if !idle(m) {
					t.Fatal("shutdown left workers")
				}
			}
		})
	}
}

func TestMemoryEvents(t *testing.T) {
	for _, mode := range []string{"counts", "connection status", "stop"} {
		t.Run(mode, func(t *testing.T) {
			d, _ := makePipeDialer(t)
			state := &clientState{}
			state.client.Store(d)
			type event struct {
				at   time.Time
				name string
				list []wshrpc.PortForwardInfo
			}
			events := make(chan event, 256)
			m := makeMemoryManager(t, state, func(name string, list []wshrpc.PortForwardInfo) { events <- event{time.Now(), name, list} })
			f := startTest(t, m, 8888)
			next := func() event {
				select {
				case e := <-events:
					return e
				case <-time.After(3 * time.Second):
					t.Fatal("missing event")
					return event{}
				}
			}
			first := next()
			if first.name != f.ConnName || len(first.list) != 1 {
				t.Fatal("invalid snapshot")
			}
			if first.list[0].Status != wshrpc.PortForwardStatus_Waiting {
				t.Fatal("expected waiting before the first remote connection")
			}
			initialConn := memoryConnect(t, m, f)
			echoTest(t, initialConn)
			first = next()
			if first.list[0].Status != wshrpc.PortForwardStatus_Active {
				t.Fatal("expected active after the first remote connection")
			}
			switch mode {
			case "counts":
				conns := make([]net.Conn, 50)
				conns[0] = initialConn
				for i := range conns {
					if i > 0 {
						conns[i] = memoryConnect(t, m, f)
					}
				}
				waitFor(t, func() bool { return m.List("")[0].ActiveConns == 50 })
				last := first
				for _, target := range []int{50, 0} {
					if target == 0 {
						for _, c := range conns {
							c.Close()
						}
					}
					for {
						e := next()
						if e.at.Sub(last.at) < eventInterval-time.Millisecond {
							t.Fatalf("events too close: %v", e.at.Sub(last.at))
						}
						last = e
						if e.list[0].ActiveConns == target {
							break
						}
					}
				}
			case "connection status":
				state.client.Store(nil)
				m.Refresh("")
				if next().list[0].Status != wshrpc.PortForwardStatus_Waiting {
					t.Fatal("expected waiting")
				}
				state.client.Store(d)
				m.Refresh("")
				if m.List("")[0].Status != wshrpc.PortForwardStatus_Waiting {
					t.Fatal("expected waiting until the new transport reaches the remote service")
				}
				reconnected := memoryConnect(t, m, f)
				echoTest(t, reconnected)
				if next().list[0].Status != wshrpc.PortForwardStatus_Active {
					t.Fatal("expected active")
				}
			case "stop":
				m.Stop(f.Id)
				e := next()
				if e.name != f.ConnName || e.list == nil || len(e.list) != 0 {
					t.Fatal("expected empty scoped list")
				}
			}
		})
	}
}

func TestMemoryForwardLimitAndCancellation(t *testing.T) {
	m := makeMemoryManager(t, &clientState{}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := m.Start(ctx, wshrpc.CommandPortForwardStartData{ConnName: "host", RemotePort: 8888}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	for i := 0; i < maxForwards; i++ {
		_, err := m.Start(context.Background(), wshrpc.CommandPortForwardStartData{ConnName: fmt.Sprintf("host%d", i), RemotePort: 8888})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := m.Start(context.Background(), wshrpc.CommandPortForwardStartData{ConnName: "overflow", RemotePort: 8888}); err == nil {
		t.Fatal("forward limit not enforced")
	}
}
