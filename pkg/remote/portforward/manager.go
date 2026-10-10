// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package portforward

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/google/uuid"
)

const (
	dialTimeout     = 10 * time.Second
	eventInterval   = 250 * time.Millisecond
	maxForwards     = 128
	maxSessions     = 512
	maxPendingDials = 64
	sshOnlyError    = "port forwarding is only needed for SSH connections"
)

// Implementations must be comparable (normally pointers), and Close must unblock Dial.
type Dialer interface {
	Dial(network, address string) (net.Conn, error)
	Close() error
}

type forwardKey struct {
	connName   string
	remoteHost string
	remotePort int
}

type forward struct {
	info     wshrpc.PortForwardInfo
	key      forwardKey
	listener net.Listener
	client   Dialer
	sessions map[*session]bool
}

type session struct {
	local  net.Conn
	cancel context.CancelFunc
	active bool
}

type eventState struct {
	dirty  bool
	urgent bool
	last   time.Time
}

type Manager struct {
	lock         sync.Mutex
	forwards     map[string]*forward
	keys         map[forwardKey]*forward
	events       map[string]*eventState
	pending      map[Dialer]int
	clients      map[Dialer]int
	sessionCount int
	dialCount    int
	closed       bool
	lookup       func(string) Dialer
	listen       func(wshrpc.CommandPortForwardStartData) (net.Listener, error)
	publish      func(string, []wshrpc.PortForwardInfo)
	closeDialer  func(Dialer)
	dialTimeout  time.Duration
	wake         chan struct{}
	done         chan struct{}
	closeOnce    sync.Once
	workers      sync.WaitGroup
}

func MakeManager(lookup func(string) Dialer, publish func(string, []wshrpc.PortForwardInfo)) *Manager {
	m := &Manager{
		forwards: make(map[string]*forward), keys: make(map[forwardKey]*forward),
		events: make(map[string]*eventState), pending: make(map[Dialer]int), clients: make(map[Dialer]int),
		lookup: lookup, listen: listen, publish: publish, closeDialer: func(d Dialer) { d.Close() },
		dialTimeout: dialTimeout, wake: make(chan struct{}, 1), done: make(chan struct{}),
	}
	m.workers.Add(1)
	go m.publishLoop()
	return m
}

func validateStart(data wshrpc.CommandPortForwardStartData) (wshrpc.CommandPortForwardStartData, error) {
	if data.ConnName == "" || data.ConnName == "local" || strings.HasPrefix(data.ConnName, "local:") || strings.HasPrefix(data.ConnName, "wsl://") {
		return data, errors.New(sshOnlyError)
	}
	if _, err := remote.ParseOpts(data.ConnName); err != nil {
		return data, fmt.Errorf("invalid SSH connection name: %w", err)
	}
	if data.RemotePort < 1 || data.RemotePort > 65535 {
		return data, errors.New("remote port must be between 1 and 65535")
	}
	if data.LocalPort < 0 || data.LocalPort > 65535 {
		return data, errors.New("local port must be between 0 and 65535")
	}
	if data.RemoteHost == "" {
		data.RemoteHost = "127.0.0.1"
	}
	if len(data.ConnName) > 1024 || len(data.RemoteHost) > 253 || strings.ContainsAny(data.RemoteHost, "\x00\r\n\t /[]") {
		return data, errors.New("invalid remote host or connection name")
	}
	return data, nil
}

func listen(data wshrpc.CommandPortForwardStartData) (net.Listener, error) {
	port := data.LocalPort
	if port == 0 {
		port = data.RemotePort
	}
	l, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err == nil {
		return l, nil
	}
	if data.LocalPort == 0 {
		return net.Listen("tcp4", "127.0.0.1:0")
	}
	if errors.Is(err, syscall.EADDRINUSE) {
		return nil, fmt.Errorf("local port %d is in use", port)
	}
	return nil, fmt.Errorf("cannot listen on local port %d: %w", port, err)
}

func (m *Manager) Start(ctx context.Context, data wshrpc.CommandPortForwardStartData) (*wshrpc.PortForwardInfo, error) {
	data, err := validateStart(data)
	if err != nil {
		return nil, err
	}
	m.lock.Lock()
	defer m.lock.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if m.closed {
		return nil, errors.New("port forwarding manager is closed")
	}
	key := forwardKey{data.ConnName, data.RemoteHost, data.RemotePort}
	if f := m.keys[key]; f != nil {
		info := f.info
		return &info, nil
	}
	// Tombstones also count until their empty snapshot has been published.
	if len(m.forwards) >= maxForwards || (m.events[data.ConnName] == nil && len(m.events) >= maxForwards) {
		return nil, errors.New("port forwarding limit reached")
	}
	l, err := m.listen(data)
	if err != nil {
		return nil, err
	}
	f := &forward{
		key: key, listener: l, client: m.lookup(data.ConnName), sessions: make(map[*session]bool),
		info: wshrpc.PortForwardInfo{
			Id: uuid.NewString(), ConnName: data.ConnName, RemoteHost: data.RemoteHost,
			RemotePort: data.RemotePort, LocalPort: l.Addr().(*net.TCPAddr).Port,
			Status: wshrpc.PortForwardStatus_Waiting, CreatedTs: time.Now().UnixMilli(),
		},
	}
	if f.client != nil {
		f.info.Status = wshrpc.PortForwardStatus_Active
	}
	m.forwards[f.info.Id], m.keys[key] = f, f
	m.changedLocked(data.ConnName, true)
	m.workers.Add(1)
	go m.acceptLoop(f)
	info := f.info
	return &info, nil
}

func (m *Manager) listLocked(connName string) []wshrpc.PortForwardInfo {
	result := make([]wshrpc.PortForwardInfo, 0)
	for _, f := range m.forwards {
		if connName == "" || connName == f.info.ConnName {
			result = append(result, f.info)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if a.ConnName != b.ConnName {
			return a.ConnName < b.ConnName
		}
		if a.RemotePort != b.RemotePort {
			return a.RemotePort < b.RemotePort
		}
		if a.RemoteHost != b.RemoteHost {
			return a.RemoteHost < b.RemoteHost
		}
		return a.Id < b.Id
	})
	return result
}

func (m *Manager) List(connName string) []wshrpc.PortForwardInfo {
	m.lock.Lock()
	defer m.lock.Unlock()
	return m.listLocked(connName)
}

func (m *Manager) removeLocked(f *forward) {
	delete(m.forwards, f.info.Id)
	delete(m.keys, f.key)
	f.listener.Close()
	for s := range f.sessions {
		s.local.Close()
		s.cancel()
		m.deactivateLocked(f, s)
	}
	m.changedLocked(f.info.ConnName, true)
}

func (m *Manager) Stop(id string) error {
	m.lock.Lock()
	defer m.lock.Unlock()
	if f := m.forwards[id]; f != nil {
		m.removeLocked(f)
	}
	return nil
}

func (m *Manager) statusLocked(f *forward, status, message string) {
	if f.info.Status == status && f.info.Error == message {
		return
	}
	f.info.Status, f.info.Error = status, message
	m.changedLocked(f.info.ConnName, true)
}

func (m *Manager) refreshLocked(f *forward) Dialer {
	client := m.lookup(f.info.ConnName)
	if client != f.client {
		f.client = client
		status := wshrpc.PortForwardStatus_Waiting
		if client != nil {
			status = wshrpc.PortForwardStatus_Active
		}
		m.statusLocked(f, status, "")
		for s := range f.sessions {
			s.local.Close()
			s.cancel()
			m.deactivateLocked(f, s)
		}
	}
	return client
}

// Read current state, since queued connection events may describe an older SSH client.
func (m *Manager) Refresh(connName string) {
	m.lock.Lock()
	defer m.lock.Unlock()
	for _, f := range m.forwards {
		if connName == "" || f.info.ConnName == connName {
			m.refreshLocked(f)
		}
	}
}

func (m *Manager) acceptLoop(f *forward) {
	defer m.workers.Done()
	for {
		local, err := f.listener.Accept()
		if err != nil {
			m.listenerFailed(f, err)
			return
		}
		if !m.accept(f, local) {
			local.Close()
		}
	}
}

func (m *Manager) listenerFailed(f *forward, err error) {
	m.lock.Lock()
	defer m.lock.Unlock()
	if m.forwards[f.info.Id] == f {
		m.statusLocked(f, wshrpc.PortForwardStatus_Error, "local listener closed: "+err.Error())
	}
}

func (m *Manager) accept(f *forward, local net.Conn) bool {
	m.lock.Lock()
	defer m.lock.Unlock()
	if m.closed || m.forwards[f.info.Id] != f {
		return false
	}
	client := m.refreshLocked(f)
	if client == nil {
		m.statusLocked(f, wshrpc.PortForwardStatus_Waiting, "")
		return false
	}
	if m.sessionCount >= maxSessions || m.dialCount >= maxPendingDials {
		m.statusLocked(f, wshrpc.PortForwardStatus_Error, "too many port forwarding connections or pending dials")
		return false
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &session{local: local, cancel: cancel}
	f.sessions[s] = true
	m.sessionCount++
	m.clients[client]++
	m.dialCount++
	m.pending[client]++
	m.workers.Add(2)
	result := make(chan net.Conn)
	dialCtx, dialCancel := context.WithTimeout(ctx, m.dialTimeout)
	go func() {
		defer m.workers.Done()
		defer m.dialFinished(client)
		remoteConn, err := client.Dial("tcp", net.JoinHostPort(f.key.remoteHost, strconv.Itoa(f.key.remotePort)))
		if err != nil {
			m.dialFailed(f, client, dialCtx, err)
			if remoteConn != nil {
				remoteConn.Close()
				remoteConn = nil
			}
		}
		select {
		case result <- remoteConn:
		case <-dialCtx.Done():
			if remoteConn != nil {
				remoteConn.Close()
			}
		}
	}()
	go m.serve(ctx, dialCtx, dialCancel, f, s, client, result)
	return true
}

func (m *Manager) dialFinished(client Dialer) {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.dialCount--
	m.pending[client]--
	if m.pending[client] == 0 {
		delete(m.pending, client)
	}
}

func (m *Manager) dialFailed(f *forward, client Dialer, ctx context.Context, err error) {
	m.lock.Lock()
	defer m.lock.Unlock()
	if ctx.Err() != nil || m.forwards[f.info.Id] != f || m.refreshLocked(f) != client {
		return
	}
	message := fmt.Sprintf("cannot connect to %s on %s", net.JoinHostPort(f.key.remoteHost, strconv.Itoa(f.key.remotePort)), f.key.connName)
	if errors.Is(err, context.DeadlineExceeded) {
		message = "remote connection timed out after 10 seconds"
	}
	m.statusLocked(f, wshrpc.PortForwardStatus_Error, message)
}

func (m *Manager) activate(f *forward, s *session, client Dialer, ctx context.Context) bool {
	m.lock.Lock()
	defer m.lock.Unlock()
	if m.forwards[f.info.Id] != f || m.refreshLocked(f) != client || ctx.Err() != nil {
		return false
	}
	s.active = true
	f.info.ActiveConns++
	m.statusLocked(f, wshrpc.PortForwardStatus_Active, "")
	m.changedLocked(f.info.ConnName, false)
	return true
}

func (m *Manager) finish(f *forward, s *session, client Dialer) {
	m.lock.Lock()
	defer m.lock.Unlock()
	delete(f.sessions, s)
	m.sessionCount--
	m.clients[client]--
	if m.clients[client] == 0 {
		delete(m.clients, client)
	}
	m.deactivateLocked(f, s)
}

func (m *Manager) deactivateLocked(f *forward, s *session) {
	if s.active {
		s.active = false
		f.info.ActiveConns--
		if m.forwards[f.info.Id] == f {
			m.changedLocked(f.info.ConnName, false)
		}
	}
}

func (m *Manager) deactivate(f *forward, s *session) {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.deactivateLocked(f, s)
}

func (m *Manager) serve(ctx, dialCtx context.Context, dialCancel context.CancelFunc, f *forward, s *session, client Dialer, result <-chan net.Conn) {
	defer m.workers.Done()
	defer m.finish(f, s, client)
	defer s.cancel()
	defer dialCancel()
	defer s.local.Close()
	var remoteConn net.Conn
	select {
	case remoteConn = <-result:
	case <-dialCtx.Done():
		if ctx.Err() == nil {
			m.dialFailed(f, client, ctx, context.DeadlineExceeded)
		}
		return
	}
	if remoteConn == nil {
		return
	}
	// A result and the deadline can both be ready when select runs.
	if err := dialCtx.Err(); err != nil {
		m.dialFailed(f, client, ctx, err)
		remoteConn.Close()
		return
	}
	dialCancel()
	if !m.activate(f, s, client, ctx) {
		remoteConn.Close()
		return
	}
	copyDone := make(chan struct{}, 2)
	copyOne := func(dst, src net.Conn) {
		io.Copy(dst, src)
		if cw, ok := dst.(interface{ CloseWrite() error }); ok {
			cw.CloseWrite()
		}
		copyDone <- struct{}{}
	}
	go copyOne(remoteConn, s.local)
	go copyOne(s.local, remoteConn)
	finished := 0
	select {
	case <-ctx.Done():
	case <-copyDone:
		finished++
	}
	m.deactivate(f, s)
	s.local.Close()
	remoteConn.Close()
	for finished < 2 {
		<-copyDone
		finished++
	}
}

func (m *Manager) changedLocked(connName string, urgent bool) {
	e := m.events[connName]
	if e == nil {
		e = &eventState{}
		m.events[connName] = e
	}
	e.dirty, e.urgent = true, e.urgent || urgent
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

func (m *Manager) snapshots() map[string][]wshrpc.PortForwardInfo {
	m.lock.Lock()
	defer m.lock.Unlock()
	result := make(map[string][]wshrpc.PortForwardInfo)
	now := time.Now()
	for name, e := range m.events {
		if !e.dirty || (!e.urgent && now.Sub(e.last) < eventInterval) {
			continue
		}
		result[name] = m.listLocked(name)
		e.dirty, e.urgent, e.last = false, false, now
		if len(result[name]) == 0 {
			delete(m.events, name)
		}
	}
	return result
}

func (m *Manager) publishLoop() {
	defer m.workers.Done()
	ticker := time.NewTicker(eventInterval / 10)
	defer ticker.Stop()
	for {
		select {
		case <-m.done:
			return
		case <-m.wake:
		case <-ticker.C:
		}
		for name, list := range m.snapshots() {
			m.publish(name, list)
			m.published(name)
		}
	}
}

func (m *Manager) published(name string) {
	m.lock.Lock()
	defer m.lock.Unlock()
	if e := m.events[name]; e != nil {
		e.last = time.Now()
	}
}

func (m *Manager) shutdown() []Dialer {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.closed = true
	for _, f := range m.forwards {
		m.removeLocked(f)
	}
	close(m.done)
	// Relays end once their local and remote conns close; only an in-flight ssh Dial cannot be
	// cancelled, so only those transports are closed.
	result := make([]Dialer, 0, len(m.pending))
	for client := range m.pending {
		result = append(result, client)
	}
	return result
}

// Only for process shutdown: transports with an in-flight dial must close to release it.
func (m *Manager) CloseAll() {
	m.closeOnce.Do(func() {
		var closes sync.WaitGroup
		for _, client := range m.shutdown() {
			closes.Add(1)
			go func() { defer closes.Done(); m.closeDialer(client) }()
		}
		closes.Wait()
		m.workers.Wait()
	})
}
