// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/utilds"
	"golang.org/x/crypto/ssh"
)

type testSSHServerOpts struct {
	ignoreKeepAlives bool
}

// startTestSSHClient returns a client connected to an in-process SSH server. The server
// answers keepalive@openssh.com unless ignoreKeepAlives is set (simulating a dead peer).
func startTestSSHClient(t *testing.T, opts testSSHServerOpts) *ssh.Client {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey failed: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		t.Fatalf("NewSignerFromKey failed: %v", err)
	}
	serverConfig := &ssh.ServerConfig{NoClientAuth: true}
	serverConfig.AddHostKey(signer)
	tcpListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen failed: %v", err)
	}
	t.Cleanup(func() { tcpListener.Close() })
	go func() {
		serverNetConn, acceptErr := tcpListener.Accept()
		if acceptErr != nil {
			return
		}
		serverConn, newChannels, requests, serverErr := ssh.NewServerConn(serverNetConn, serverConfig)
		if serverErr != nil {
			return
		}
		defer serverConn.Close()
		go func() {
			for newChannel := range newChannels {
				newChannel.Reject(ssh.UnknownChannelType, "no channels")
			}
		}()
		for request := range requests {
			if opts.ignoreKeepAlives {
				continue
			}
			request.Reply(false, nil)
		}
	}()
	clientNetConn, err := net.Dial("tcp", tcpListener.Addr().String())
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	clientConn, newChannels, requests, err := ssh.NewClientConn(clientNetConn, "test", &ssh.ClientConfig{
		User:            "test",
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err != nil {
		t.Fatalf("NewClientConn failed: %v", err)
	}
	client := ssh.NewClient(clientConn, newChannels, requests)
	t.Cleanup(func() { client.Close() })
	return client
}

func makeTestConn(t *testing.T, name string) *SSHConn {
	t.Helper()
	opts, err := remote.ParseOpts(name)
	if err != nil {
		t.Fatalf("ParseOpts failed: %v", err)
	}
	return &SSHConn{
		lock:             &sync.Mutex{},
		lifecycleLock:    &sync.Mutex{},
		Status:           Status_Init,
		ConnHealthStatus: ConnHealthStatus_Good,
		WshEnabled:       &atomic.Bool{},
		Opts:             opts,
	}
}

func setTestAutoReconnectPolicy(t *testing.T, policyFn func(string) bool) {
	t.Helper()
	original := getAutoReconnectPolicy()
	SetAutoReconnectPolicy(policyFn)
	t.Cleanup(func() { SetAutoReconnectPolicy(original) })
}

func TestComputeReconnectDelay(t *testing.T) {
	noJitter := func() float64 { return 0.5 }
	if got := computeReconnectDelay(1, noJitter); got != ReconnectInitialDelay {
		t.Fatalf("attempt 1 delay = %v", got)
	}
	if got := computeReconnectDelay(3, noJitter); got != 4*time.Second {
		t.Fatalf("attempt 3 delay = %v", got)
	}
	if got := computeReconnectDelay(50, noJitter); got != ReconnectMaxDelay {
		t.Fatalf("attempt 50 delay = %v, want cap %v", got, ReconnectMaxDelay)
	}
	maxJitter := computeReconnectDelay(50, func() float64 { return 1 })
	if maxJitter > time.Duration(float64(ReconnectMaxDelay)*(1+ReconnectJitterFraction)) {
		t.Fatalf("jitter exceeded bound: %v", maxJitter)
	}
	minJitter := computeReconnectDelay(1, func() float64 { return 0 })
	if minJitter < time.Duration(float64(ReconnectInitialDelay)*(1-ReconnectJitterFraction)) {
		t.Fatalf("jitter below bound: %v", minJitter)
	}
}

func TestIsRetryableConnectError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"dial timeout", utilds.MakeSubCodedError(remote.ConnErrCode_Dial, remote.DialSubCode_Timeout, errors.New("i/o timeout")), true},
		{"refused", fmt.Errorf("dial tcp: connection refused"), true},
		{"handshake eof", fmt.Errorf("ssh: handshake failed: EOF"), true},
		{"auth", fmt.Errorf("ssh: handshake failed: ssh: unable to authenticate, attempted methods [none publickey]"), false},
		{"needs input", fmt.Errorf("ssh: handshake failed: %w", utilds.Errorf(remote.ConnErrCode_UserInputReq, "password needed")), false},
		{"host key changed", utilds.Errorf(remote.ConnErrCode_HostKeyChanged, "changed"), false},
		{"proxycommand", utilds.Errorf(remote.ConnErrCode_ProxyCommand, "unsupported"), false},
		{"nil", nil, false},
	}
	for _, tc := range cases {
		if got := isRetryableConnectError(tc.err); got != tc.want {
			t.Errorf("%s: isRetryableConnectError = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestMergeIdentityFilesDedups(t *testing.T) {
	got := mergeIdentityFiles([]string{"~/.ssh/a"}, []string{"~/.ssh/a", "~/.ssh/b", "~/.ssh/c", "~/.ssh/b"})
	want := []string{"~/.ssh/a", "~/.ssh/b", "~/.ssh/c"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("mergeIdentityFiles = %v, want %v", got, want)
	}
}

func TestStartConnServerAndDomainSocketRejectNilClient(t *testing.T) {
	conn := makeTestConn(t, "nilclient@example.com")
	conn.Status = Status_Connecting
	if err := conn.OpenDomainSocketListener(context.Background()); err == nil {
		t.Fatalf("expected error from OpenDomainSocketListener with nil client")
	}
	if _, _, _, err := conn.StartConnServer(context.Background(), false, true); err == nil {
		t.Fatalf("expected error from StartConnServer with nil client")
	}
}

func TestWaitForDisconnectIgnoresSupersededClient(t *testing.T) {
	setTestAutoReconnectPolicy(t, func(string) bool { return false })
	conn := makeTestConn(t, "superseded@example.com")
	oldClient := startTestSSHClient(t, testSSHServerOpts{})
	newClient := startTestSSHClient(t, testSSHServerOpts{})
	conn.Status = Status_Connected
	conn.Client = newClient

	done := make(chan struct{})
	go func() {
		conn.waitForDisconnect(oldClient)
		close(done)
	}()
	oldClient.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("waitForDisconnect did not return")
	}
	if conn.GetStatus() != Status_Connected || conn.GetClient() != newClient {
		t.Fatalf("stale client teardown clobbered the newer connection (status=%s)", conn.GetStatus())
	}

	done = make(chan struct{})
	go func() {
		conn.waitForDisconnect(newClient)
		close(done)
	}()
	newClient.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("waitForDisconnect did not return for current client")
	}
	if conn.GetStatus() != Status_Disconnected || conn.GetClient() != nil {
		t.Fatalf("current client disconnect not handled (status=%s)", conn.GetStatus())
	}
}

func TestDomainSocketClearOnlyClearsOwnListener(t *testing.T) {
	conn := makeTestConn(t, "sockclear@example.com")
	oldListener := &trackingListener{}
	newListener := &trackingListener{}
	conn.DomainSockListener = newListener
	conn.DomainSockName = "/tmp/new.sock"
	clearDomainSocketIfCurrent(conn, oldListener)
	if conn.DomainSockListener != newListener || conn.DomainSockName != "/tmp/new.sock" {
		t.Fatalf("stale listener exit cleared the newer listener")
	}
	clearDomainSocketIfCurrent(conn, newListener)
	if conn.DomainSockListener != nil || conn.DomainSockName != "" {
		t.Fatalf("own listener exit did not clear state")
	}
}

type trackingListener struct{}

func (l *trackingListener) Accept() (net.Conn, error) { return nil, errors.New("closed") }
func (l *trackingListener) Addr() net.Addr            { return nil }
func (l *trackingListener) Close() error              { return nil }

func TestClearConnControllerIdentity(t *testing.T) {
	conn := makeTestConn(t, "controller@example.com")
	current := &ssh.Session{}
	stale := &ssh.Session{}
	conn.ConnController = current
	conn.WshEnabled.Store(true)
	if conn.clearConnController(stale, nil) {
		t.Fatalf("stale connserver exit should not clear current controller")
	}
	if !conn.WshEnabled.Load() || conn.ConnController != current {
		t.Fatalf("stale connserver exit disabled wsh")
	}
	if !conn.clearConnController(current, errors.New("exit 1")) {
		t.Fatalf("current connserver exit should clear controller")
	}
	if conn.WshEnabled.Load() || conn.ConnController != nil || conn.WshError == "" {
		t.Fatalf("current connserver exit not recorded")
	}
}

func TestCloseAbortsInFlightConnectAttempt(t *testing.T) {
	conn := makeTestConn(t, "abort@example.com")
	conn.Status = Status_Connecting
	attemptCtx, attemptCancel := context.WithCancel(context.Background())
	defer attemptCancel()
	conn.setConnectAbort(attemptCancel)
	lockHeld := make(chan struct{})
	go func() {
		conn.lifecycleLock.Lock()
		close(lockHeld)
		<-attemptCtx.Done()
		conn.WithLock(func() {
			conn.Status = Status_Disconnected
		})
		conn.lifecycleLock.Unlock()
	}()
	<-lockHeld
	closed := make(chan struct{})
	go func() {
		conn.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("Close() waited behind an in-flight connect instead of aborting it")
	}
	if conn.GetStatus() != Status_Disconnected {
		t.Fatalf("unexpected status after abort: %s", conn.GetStatus())
	}
}

func TestCloseStopsAutoReconnectLoop(t *testing.T) {
	setTestAutoReconnectPolicy(t, func(string) bool { return true })
	conn := makeTestConn(t, "reconnectstop@example.com")
	conn.Status = Status_Disconnected
	conn.maybeStartAutoReconnect("test")
	status := conn.DeriveConnStatus()
	if !status.Reconnecting {
		t.Fatalf("expected reconnecting status")
	}
	conn.Close()
	status = conn.DeriveConnStatus()
	if status.Reconnecting || status.Status != Status_Disconnected {
		t.Fatalf("Close did not stop reconnect loop: %+v", status)
	}
	// the loop must not restart itself after a user disconnect
	time.Sleep(50 * time.Millisecond)
	if conn.DeriveConnStatus().Reconnecting {
		t.Fatalf("reconnect loop resumed after Close")
	}
}

func TestAutoReconnectRespectsPolicy(t *testing.T) {
	setTestAutoReconnectPolicy(t, func(string) bool { return false })
	conn := makeTestConn(t, "nopolicy@example.com")
	conn.Status = Status_Disconnected
	conn.maybeStartAutoReconnect("test")
	if conn.DeriveConnStatus().Reconnecting {
		t.Fatalf("reconnect started for a connection the policy rejected")
	}
}

func TestMonitorSeedsActivityAndSendsHelperlessKeepAlive(t *testing.T) {
	conn := makeTestConn(t, "keepalive@example.com")
	client := startTestSSHClient(t, testSSHServerOpts{})
	conn.Client = client
	conn.Status = Status_Connected
	monitor := MakeConnMonitor(conn, client)
	defer monitor.Close()
	if monitor.LastActivityTime.Load() == 0 {
		t.Fatalf("monitor must seed LastActivityTime so helperless connections get keepalives")
	}
	monitor.LastActivityTime.Store(time.Now().Add(-time.Minute).UnixMilli())
	monitor.checkConnection()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if time.Now().UnixMilli()-monitor.LastActivityTime.Load() < 5000 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("keepalive reply did not refresh LastActivityTime")
}

func TestMonitorClosesDeadConnection(t *testing.T) {
	setTestAutoReconnectPolicy(t, func(string) bool { return false })
	conn := makeTestConn(t, "deadconn@example.com")
	client := startTestSSHClient(t, testSSHServerOpts{ignoreKeepAlives: true})
	conn.Client = client
	conn.Status = Status_Connected
	monitor := MakeConnMonitor(conn, client)
	defer monitor.Close()
	monitor.KeepAlive = remote.KeepAliveSettings{Interval: time.Second, CountMax: 2}
	monitor.lock.Lock()
	monitor.KeepAliveInFlight = true
	monitor.KeepAliveSentTime.Store(time.Now().Add(-12 * time.Second).UnixMilli())
	monitor.lock.Unlock()
	monitor.checkConnection()

	waitDone := make(chan struct{})
	go func() {
		client.Wait()
		close(waitDone)
	}()
	select {
	case <-waitDone:
	case <-time.After(5 * time.Second):
		t.Fatal("unresponsive connection was not closed")
	}
	if conn.GetConnHealthStatus() != ConnHealthStatus_Stalled {
		t.Fatalf("expected stalled health status, got %s", conn.GetConnHealthStatus())
	}
}

func TestMonitorKeepsUnresponsiveConnectionWithoutPolicy(t *testing.T) {
	setTestAutoReconnectPolicy(t, func(string) bool { return false })
	conn := makeTestConn(t, "keepstalled@example.com")
	client := startTestSSHClient(t, testSSHServerOpts{ignoreKeepAlives: true})
	conn.Client = client
	conn.Status = Status_Connected
	monitor := MakeConnMonitor(conn, client)
	defer monitor.Close()
	monitor.handleDeadConnection("test")
	if monitor.closeRequested.Load() {
		t.Fatalf("connection without ServerAliveInterval or reconnect policy must not be force-closed")
	}
}
