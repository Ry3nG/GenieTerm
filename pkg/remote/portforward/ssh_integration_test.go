// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package portforward

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"golang.org/x/crypto/ssh"
)

type directTCPIPPayload struct {
	Host       string
	Port       uint32
	OriginHost string
	OriginPort uint32
}

// startTestSSHServer runs a minimal SSH server that only accepts direct-tcpip channels, which is
// what ssh.Client.Dial uses, so the forward is exercised through a real SSH transport.
func startTestSSHServer(t *testing.T) string {
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
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	t.Cleanup(func() {
		l.Close()
		wg.Wait()
	})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			nc, err := l.Accept()
			if err != nil {
				return
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				serveTestSSHConn(nc, config)
			}()
		}
	}()
	return l.Addr().String()
}

func serveTestSSHConn(nc net.Conn, config *ssh.ServerConfig) {
	sconn, chans, reqs, err := ssh.NewServerConn(nc, config)
	if err != nil {
		nc.Close()
		return
	}
	defer sconn.Close()
	go ssh.DiscardRequests(reqs)
	for newCh := range chans {
		if newCh.ChannelType() != "direct-tcpip" {
			newCh.Reject(ssh.UnknownChannelType, "only direct-tcpip")
			continue
		}
		var payload directTCPIPPayload
		if err := ssh.Unmarshal(newCh.ExtraData(), &payload); err != nil {
			newCh.Reject(ssh.ConnectionFailed, "bad payload")
			continue
		}
		target, err := net.Dial("tcp", net.JoinHostPort(payload.Host, strconv.Itoa(int(payload.Port))))
		if err != nil {
			newCh.Reject(ssh.ConnectionFailed, err.Error())
			continue
		}
		ch, chReqs, err := newCh.Accept()
		if err != nil {
			target.Close()
			continue
		}
		go ssh.DiscardRequests(chReqs)
		go func() {
			io.Copy(ch, target)
			ch.CloseWrite()
		}()
		go func() {
			io.Copy(target, ch)
			if tc, ok := target.(*net.TCPConn); ok {
				tc.CloseWrite()
			}
		}()
	}
}

func dialTestSSHClient(t *testing.T, addr string) *ssh.Client {
	t.Helper()
	client, err := ssh.Dial("tcp", addr, &ssh.ClientConfig{
		User:            "test",
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	return client
}

func startTestHTTPServer(t *testing.T, host string) int {
	t.Helper()
	l, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "hello from %s", r.URL.Path)
	})}
	go srv.Serve(l)
	t.Cleanup(func() { srv.Close() })
	return l.Addr().(*net.TCPAddr).Port
}

func TestForwardThroughRealSSHClient(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "::1"} {
		t.Run(host, func(t *testing.T) { testForwardThroughRealSSHClient(t, host) })
	}
}

func testForwardThroughRealSSHClient(t *testing.T, host string) {
	t.Helper()
	client := dialTestSSHClient(t, startTestSSHServer(t))
	httpPort := startTestHTTPServer(t, host)
	m := MakeManager(func(string) Dialer { return client }, func(string, []wshrpc.PortForwardInfo) {})
	t.Cleanup(m.CloseAll)

	info, err := m.Start(context.Background(), wshrpc.CommandPortForwardStartData{ConnName: "me@gpu-01", RemoteHost: host, RemotePort: httpPort})
	if err != nil {
		t.Fatal(err)
	}
	if info.LocalPort == 0 || info.Status != wshrpc.PortForwardStatus_Waiting {
		t.Fatalf("unexpected forward %+v", info)
	}
	httpClient := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}
	for i := 0; i < 3; i++ {
		resp, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/run/%d", info.LocalPort, i))
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if string(body) != fmt.Sprintf("hello from /run/%d", i) {
			t.Fatalf("request %d body = %q", i, body)
		}
	}
	waitFor(t, func() bool { return m.List("me@gpu-01")[0].ActiveConns == 0 })
	if m.List("me@gpu-01")[0].Status != wshrpc.PortForwardStatus_Active {
		t.Fatal("forward not active after successful HTTP requests")
	}

	// A raw socket that half-closes its write side must still get the full response back.
	conn, err := net.Dial("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(info.LocalPort)))
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(conn, "GET /half HTTP/1.0\r\nHost: x\r\n\r\n")
	conn.(*net.TCPConn).CloseWrite()
	reply, err := io.ReadAll(bufio.NewReader(conn))
	conn.Close()
	if err != nil || !strings.HasSuffix(string(reply), "hello from /half") {
		t.Fatalf("half-close reply = %q, err = %v", reply, err)
	}

	if err := m.Stop(info.Id); err != nil {
		t.Fatal(err)
	}
	if _, err := net.Dial("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(info.LocalPort))); err == nil {
		t.Fatal("listener still accepts after Stop")
	}
	// Stopping a forward must leave the shared SSH connection usable for the next one.
	again, err := m.Start(context.Background(), wshrpc.CommandPortForwardStartData{ConnName: "me@gpu-01", RemoteHost: host, RemotePort: httpPort})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/again", again.LocalPort))
	if err != nil {
		t.Fatalf("ssh client unusable after Stop: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "hello from /again" {
		t.Fatalf("second forward body = %q", body)
	}
}

func TestForwardReportsNothingListening(t *testing.T) {
	client := dialTestSSHClient(t, startTestSSHServer(t))
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	deadPort := l.Addr().(*net.TCPAddr).Port
	l.Close()
	// Both ends are this machine in the test, so keep the forward off the dead port itself.
	ll, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	localPort := ll.Addr().(*net.TCPAddr).Port
	ll.Close()
	m := MakeManager(func(string) Dialer { return client }, func(string, []wshrpc.PortForwardInfo) {})
	t.Cleanup(m.CloseAll)

	info, err := m.Start(context.Background(), wshrpc.CommandPortForwardStartData{
		ConnName: "me@gpu-01", RemotePort: deadPort, LocalPort: localPort,
	})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.Dial("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(info.LocalPort)))
	if err != nil {
		t.Fatal(err)
	}
	io.ReadAll(conn)
	conn.Close()
	waitFor(t, func() bool { return m.List("me@gpu-01")[0].Status == wshrpc.PortForwardStatus_Error })
	if msg := m.List("me@gpu-01")[0].Error; !strings.Contains(msg, strconv.Itoa(deadPort)) {
		t.Fatalf("error message = %q", msg)
	}
}
