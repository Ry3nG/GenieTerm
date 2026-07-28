// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"golang.org/x/crypto/ssh"
)

func TestIsWshVersionUpToDateRequiresGeniePrimaryHelper(t *testing.T) {
	oldVersion := wavebase.WaveVersion
	t.Cleanup(func() {
		wavebase.WaveVersion = oldVersion
	})
	wavebase.WaveVersion = "0.4.0"

	ok, version, osArch, err := IsWshVersionUpToDate(context.Background(), "genie v0.4.0")
	if err != nil {
		t.Fatalf("genie version check returned error: %v", err)
	}
	if !ok || version != "v0.4.0" || osArch != "" {
		t.Fatalf("genie current version returned ok=%v version=%q osArch=%q", ok, version, osArch)
	}

	ok, version, osArch, err = IsWshVersionUpToDate(context.Background(), "wsh v0.4.0")
	if err != nil {
		t.Fatalf("wsh fallback version check returned error: %v", err)
	}
	if ok || version != "v0.4.0" || osArch != "" {
		t.Fatalf("wsh fallback should require genie install, got ok=%v version=%q osArch=%q", ok, version, osArch)
	}
}

func TestMakeConnServerCommandPrefersGenieWithWshFallback(t *testing.T) {
	cmd := MakeConnServerCommand(
		wavebase.RemoteFullGenieBinPath,
		wavebase.RemoteFullWshBinPath,
		"prod-east",
		"--dev",
		"--router-domainsocket",
	)

	if !strings.Contains(cmd, wavebase.RemoteFullGenieBinPath) {
		t.Fatalf("command does not contain genie primary path: %s", cmd)
	}
	if !strings.Contains(cmd, wavebase.RemoteFullWshBinPath) {
		t.Fatalf("command does not contain wsh fallback path: %s", cmd)
	}
	if strings.Index(cmd, wavebase.RemoteFullGenieBinPath) > strings.Index(cmd, wavebase.RemoteFullWshBinPath) {
		t.Fatalf("command should prefer genie before wsh fallback: %s", cmd)
	}
	if !strings.Contains(cmd, "mkdir -p ~/.genieterm ~/.genieterm/client || exit 1;") {
		t.Fatalf("command should create genie runtime directories before helper startup: %s", cmd)
	}
	if !strings.Contains(cmd, "connserver --conn prod-east --dev --router-domainsocket") {
		t.Fatalf("command does not preserve connserver arguments: %s", cmd)
	}
}

// blockingListener simulates a handle whose Close() hangs on a dead network
// transport (as DomainSockListener.Close() can when it tries to send SSH
// packets over a reset connection).
type blockingListener struct {
	closeStarted chan struct{}
	release      chan struct{}
}

func (l *blockingListener) Accept() (net.Conn, error) { return nil, errors.New("not implemented") }
func (l *blockingListener) Addr() net.Addr            { return nil }
func (l *blockingListener) Close() error {
	close(l.closeStarted)
	<-l.release
	return nil
}

// A dropped SSH connection used to wedge the conn forever: closeInternal ran
// while holding lifecycleLock, and a handle Close() that blocked on the dead
// transport meant Status never went to Disconnected and every later
// connect/disconnect deadlocked. closeInternal must now return promptly and let
// the slow close happen in the background.
func TestCloseInternalDoesNotBlockOnDeadHandle(t *testing.T) {
	opts, err := remote.ParseOpts("zrgong@paw-5090-ws")
	if err != nil {
		t.Fatalf("ParseOpts failed: %v", err)
	}
	listener := &blockingListener{
		closeStarted: make(chan struct{}),
		release:      make(chan struct{}),
	}
	defer close(listener.release)

	conn := &SSHConn{
		lock:               &sync.Mutex{},
		lifecycleLock:      &sync.Mutex{},
		Status:             Status_Connected,
		ConnHealthStatus:   ConnHealthStatus_Good,
		WshEnabled:         &atomic.Bool{},
		Opts:               opts,
		DomainSockListener: listener,
	}

	returned := make(chan struct{})
	go func() {
		conn.closeInternal_withlifecyclelock()
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("closeInternal_withlifecyclelock blocked on a dead handle close")
	}

	select {
	case <-listener.closeStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("background close never ran the handle Close()")
	}

	conn.lock.Lock()
	detached := conn.DomainSockListener == nil
	conn.lock.Unlock()
	if !detached {
		t.Fatal("expected DomainSockListener to be detached (nil) so a reconnect starts fresh")
	}
}

type trackingCloser struct {
	closeCount atomic.Int32
}

func (c *trackingCloser) Close() error {
	c.closeCount.Add(1)
	return nil
}

func TestCloseClientOwnedSSHHandlesUsesParentOwnership(t *testing.T) {
	client := &trackingCloser{}
	listener := &trackingCloser{}
	controller := &trackingCloser{}

	closeClientOwnedSSHHandles("test", client, listener, controller)

	if client.closeCount.Load() != 1 {
		t.Fatalf("expected client to close once, got %d", client.closeCount.Load())
	}
	if listener.closeCount.Load() != 0 {
		t.Fatalf("expected client-owned listener close to be skipped, got %d", listener.closeCount.Load())
	}
	if controller.closeCount.Load() != 0 {
		t.Fatalf("expected client-owned controller close to be skipped, got %d", controller.closeCount.Load())
	}
}

func TestSSHUnixListenerCloseAfterClientCloseReturns(t *testing.T) {
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
		t.Fatalf("test server Listen failed: %v", err)
	}
	defer tcpListener.Close()
	serverResult := make(chan error, 1)
	go func() {
		serverNetConn, acceptErr := tcpListener.Accept()
		if acceptErr != nil {
			serverResult <- acceptErr
			return
		}
		serverConn, newChannels, requests, serverErr := ssh.NewServerConn(serverNetConn, serverConfig)
		if serverErr != nil {
			serverResult <- serverErr
			return
		}
		go func() {
			for newChannel := range newChannels {
				newChannel.Reject(ssh.UnknownChannelType, "test server does not accept channels")
			}
		}()
		for request := range requests {
			request.Reply(request.Type == "streamlocal-forward@openssh.com", nil)
		}
		serverResult <- serverConn.Close()
	}()

	clientNetConn, err := net.Dial("tcp", tcpListener.Addr().String())
	if err != nil {
		t.Fatalf("test client Dial failed: %v", err)
	}
	clientConfig := &ssh.ClientConfig{
		User:            "test",
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
	clientConn, newChannels, requests, err := ssh.NewClientConn(clientNetConn, "pipe", clientConfig)
	if err != nil {
		t.Fatalf("NewClientConn failed: %v", err)
	}
	client := ssh.NewClient(clientConn, newChannels, requests)
	listener, err := client.ListenUnix("/tmp/genieterm-close-regression.sock")
	if err != nil {
		client.Close()
		t.Fatalf("ListenUnix failed: %v", err)
	}
	if err := client.Close(); err != nil {
		t.Fatalf("client Close failed: %v", err)
	}

	listenerClosed := make(chan struct{})
	go func() {
		listener.Close()
		close(listenerClosed)
	}()
	select {
	case <-listenerClosed:
	case <-time.After(time.Second):
		t.Fatal("listener Close spun after its parent SSH client closed")
	}

	select {
	case serverErr := <-serverResult:
		if serverErr != nil && !errors.Is(serverErr, net.ErrClosed) {
			t.Fatalf("SSH test server failed: %v", serverErr)
		}
	case <-time.After(time.Second):
		t.Fatal("SSH test server did not stop after client close")
	}
}

func TestNotifySystemResumeSignalsActiveMonitors(t *testing.T) {
	opts, err := remote.ParseOpts("resume-test@example.com")
	if err != nil {
		t.Fatalf("ParseOpts failed: %v", err)
	}
	monitor := &ConnMonitor{checkNotifyCh: make(chan struct{}, 1)}
	conn := &SSHConn{
		lock:    &sync.Mutex{},
		Opts:    opts,
		Monitor: monitor,
	}

	globalLock.Lock()
	originalConnections := clientControllerMap
	clientControllerMap = map[remote.SSHOpts]*SSHConn{*opts: conn}
	globalLock.Unlock()
	t.Cleanup(func() {
		globalLock.Lock()
		defer globalLock.Unlock()
		clientControllerMap = originalConnections
	})

	if notified := NotifySystemResume(); notified != 1 {
		t.Fatalf("expected one monitor notification, got %d", notified)
	}
	select {
	case <-monitor.checkNotifyCh:
	default:
		t.Fatal("active monitor did not receive a resume check notification")
	}
}
