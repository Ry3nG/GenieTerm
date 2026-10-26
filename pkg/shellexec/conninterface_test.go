// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"golang.org/x/crypto/ssh"
)

func TestShellExitHelper(t *testing.T) {
	if os.Getenv("GENIETERM_TEST_SHELL_EXIT") != "1" {
		return
	}
	code, err := strconv.Atoi(os.Args[len(os.Args)-1])
	if err != nil {
		os.Exit(99)
	}
	os.Exit(code)
}

func TestCmdWrapRetainsWaitResult(t *testing.T) {
	for _, code := range []int{0, 7} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			cmd := exec.Command(os.Args[0], "-test.run=^TestShellExitHelper$", "--", strconv.Itoa(code))
			cmd.Env = append(os.Environ(), "GENIETERM_TEST_SHELL_EXIT=1")
			wrapped := MakeCmdWrap(cmd, nil, false)
			if err := wrapped.Start(); err != nil {
				t.Fatal(err)
			}
			assertRetainedWaitResult(t, wrapped, code)
		})
	}
}

func assertRetainedWaitResult(t *testing.T, conn ConnInterface, code int) {
	t.Helper()
	first := conn.Wait()
	if got := ExitCodeFromWaitErr(first); got != code {
		t.Fatalf("first wait exit code = %d, want %d (error: %v)", got, code, first)
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			if got := conn.Wait(); got != first {
				t.Errorf("repeated wait = %v, want original error %v", got, first)
			}
		})
	}
	wg.Wait()
	if got := conn.ExitCode(); got != code {
		t.Errorf("ExitCode = %d, want %d", got, code)
	}
	if first != nil {
		if got := ExitCodeFromWaitErr(fmt.Errorf("shell stopped: %w", first)); got != code {
			t.Errorf("wrapped error exit code = %d, want %d", got, code)
		}
	}
}

func TestSessionWrapRetainsWaitResult(t *testing.T) {
	for _, code := range []int{0, 7} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			session := makeExitSession(t, uint32(code), "")
			wrapped := MakeSessionWrap(session, "test-exit", nil)
			if err := wrapped.Start(); err != nil {
				t.Fatal(err)
			}
			assertRetainedWaitResult(t, wrapped, code)
		})
	}
}

func TestSessionWrapRetainsExitSignal(t *testing.T) {
	session := makeExitSession(t, 0, "TERM")
	wrapped := MakeSessionWrap(session, "test-signal", nil)
	if err := wrapped.Start(); err != nil {
		t.Fatal(err)
	}
	if err := wrapped.Wait(); err == nil {
		t.Fatal("signal exit unexpectedly succeeded")
	}
	if got := wrapped.ExitSignal(); got != "TERM" {
		t.Errorf("ExitSignal = %q, want TERM", got)
	}
}

func TestExitCodeFromUnknownWaitError(t *testing.T) {
	if got := ExitCodeFromWaitErr(errors.New("transport failed")); got != -1 {
		t.Errorf("unknown exit code = %d, want -1", got)
	}
}

func TestRunSimpleCmdInPtyStartFailure(t *testing.T) {
	cmd := exec.Command(filepath.Join(t.TempDir(), "missing-shell"))
	if _, err := RunSimpleCmdInPty(cmd, waveobj.TermSize{Rows: 24, Cols: 80}); err == nil {
		t.Fatal("starting a missing shell unexpectedly succeeded")
	}
}

func makeExitSession(t *testing.T, code uint32, signal string) *ssh.Session {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	serverDone := make(chan error, 1)
	go func() {
		serverDone <- serveExitSession(listener, config, code, signal)
	}()
	t.Cleanup(func() {
		select {
		case err := <-serverDone:
			if err != nil {
				t.Errorf("SSH test server: %v", err)
			}
		case <-time.After(10 * time.Second):
			t.Error("SSH test server did not exit")
		}
	})
	conn, err := net.DialTimeout("tcp", listener.Addr().String(), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	t.Cleanup(func() { conn.Close() })
	clientConn, channels, requests, err := ssh.NewClientConn(conn, listener.Addr().String(), &ssh.ClientConfig{
		User:            "test",
		HostKeyCallback: ssh.FixedHostKey(signer.PublicKey()),
	})
	if err != nil {
		t.Fatal(err)
	}
	client := ssh.NewClient(clientConn, channels, requests)
	t.Cleanup(func() { client.Close() })
	session, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	return session
}

func serveExitSession(listener net.Listener, config *ssh.ServerConfig, code uint32, signal string) error {
	conn, err := listener.Accept()
	if err != nil {
		return err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	server, channels, requests, err := ssh.NewServerConn(conn, config)
	if err != nil {
		return err
	}
	defer server.Close()
	go ssh.DiscardRequests(requests)
	newChannel, ok := <-channels
	if !ok {
		return errors.New("no SSH session channel")
	}
	channel, channelRequests, err := newChannel.Accept()
	if err != nil {
		return err
	}
	defer channel.Close()
	for request := range channelRequests {
		if request.Type != "exec" {
			request.Reply(false, nil)
			continue
		}
		if err := request.Reply(true, nil); err != nil {
			return err
		}
		if signal != "" {
			_, err = channel.SendRequest("exit-signal", false, ssh.Marshal(struct {
				Signal       string
				CoreDumped   bool
				ErrorMessage string
				LanguageTag  string
			}{Signal: signal}))
			return err
		}
		_, err = channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{code}))
		return err
	}
	return errors.New("SSH exec request not received")
}
