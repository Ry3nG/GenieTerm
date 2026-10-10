// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/util/shellutil"
	"github.com/Ry3nG/GenieTerm/pkg/utilds"
	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"golang.org/x/crypto/ssh"
	xknownhosts "golang.org/x/crypto/ssh/knownhosts"
)

func makeSilentConnPair(t *testing.T) (net.Conn, net.Conn) {
	t.Helper()
	clientSide, serverSide := net.Pipe()
	t.Cleanup(func() {
		clientSide.Close()
		serverSide.Close()
	})
	return clientSide, serverSide
}

func testClientConfig() *ssh.ClientConfig {
	return &ssh.ClientConfig{
		User:            "test",
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
}

func TestHandshakeWithContextKexTimeout(t *testing.T) {
	clientSide, _ := makeSilentConnPair(t)
	start := time.Now()
	_, _, _, err := handshakeWithContext(context.Background(), clientSide, "silent:22", testClientConfig(), 150*time.Millisecond)
	if err == nil {
		t.Fatalf("expected handshake error")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("handshake did not abort promptly: %v", time.Since(start))
	}
	if utilds.GetErrorSubCode(err) != DialSubCode_Timeout {
		t.Fatalf("expected timeout subcode, got %q (%v)", utilds.GetErrorSubCode(err), err)
	}
}

func TestHandshakeWithContextCancel(t *testing.T) {
	clientSide, _ := makeSilentConnPair(t)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(100*time.Millisecond, cancel)
	start := time.Now()
	_, _, _, err := handshakeWithContext(ctx, clientSide, "silent:22", testClientConfig(), time.Minute)
	if err == nil {
		t.Fatalf("expected handshake error")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("handshake did not abort promptly on cancel: %v", time.Since(start))
	}
	if utilds.GetErrorSubCode(err) != DialSubCode_ContextCanceled {
		t.Fatalf("expected context-canceled subcode, got %q (%v)", utilds.GetErrorSubCode(err), err)
	}
}

func TestParseNonNegativeInt(t *testing.T) {
	cases := map[string]*int{
		"":    nil,
		"abc": nil,
		"-1":  nil,
		"0":   intPtr(0),
		" 15": intPtr(15),
	}
	for input, want := range cases {
		got := parseNonNegativeInt(input)
		if (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Errorf("parseNonNegativeInt(%q) = %v, want %v", input, got, want)
		}
	}
}

func intPtr(v int) *int {
	return &v
}

func TestResolveKeepAliveAndConnectTimeout(t *testing.T) {
	if resolveConnectTimeout(&wconfig.ConnKeywords{}) != DefaultSshConnectTimeout {
		t.Fatalf("expected default connect timeout")
	}
	if resolveConnectTimeout(&wconfig.ConnKeywords{SshConnectTimeout: intPtr(7)}) != 7*time.Second {
		t.Fatalf("expected 7s connect timeout")
	}
	settings := resolveKeepAliveSettings(&wconfig.ConnKeywords{SshServerAliveInterval: intPtr(5)})
	if settings.Interval != 5*time.Second || settings.CountMax != DefaultSshServerAliveCountMax {
		t.Fatalf("unexpected keepalive settings: %+v", settings)
	}
	settings = resolveKeepAliveSettings(&wconfig.ConnKeywords{SshServerAliveCountMax: intPtr(1)})
	if settings.Interval != 0 || settings.CountMax != 1 {
		t.Fatalf("unexpected keepalive settings: %+v", settings)
	}
}

func TestMergeKeywordsCarriesTimeouts(t *testing.T) {
	merged := mergeKeywords(&wconfig.ConnKeywords{SshConnectTimeout: intPtr(3)}, &wconfig.ConnKeywords{SshServerAliveInterval: intPtr(9)})
	if merged.SshConnectTimeout == nil || *merged.SshConnectTimeout != 3 {
		t.Fatalf("connect timeout lost in merge")
	}
	if merged.SshServerAliveInterval == nil || *merged.SshServerAliveInterval != 9 {
		t.Fatalf("serveraliveinterval lost in merge")
	}
}

func TestHostKeyChangedErrorIsActionable(t *testing.T) {
	newPub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	oldPub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	newKey, _ := ssh.NewPublicKey(newPub)
	oldKey, _ := ssh.NewPublicKey(oldPub)
	err = makeHostKeyChangedError("example.com:2222", newKey, []xknownhosts.KnownKey{{Key: oldKey, Filename: "/home/u/.ssh/known_hosts", Line: 12}})
	msg := err.Error()
	for _, want := range []string{"/home/u/.ssh/known_hosts:12", ssh.FingerprintSHA256(newKey), ssh.FingerprintSHA256(oldKey), "ssh-keygen -R [example.com]:2222"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message missing %q: %s", want, msg)
		}
	}
	if utilds.GetErrorCode(err) != ConnErrCode_HostKeyChanged {
		t.Errorf("expected hostkey-changed code")
	}
}

func TestNoUserInputContext(t *testing.T) {
	if IsNoUserInputContext(context.Background()) {
		t.Fatalf("background ctx should allow user input")
	}
	ctx := ContextWithNoUserInput(context.Background())
	if !IsNoUserInputContext(ctx) {
		t.Fatalf("expected no-user-input ctx")
	}
	cb := createPasswordCallbackPrompt(ctx, "host", nil, &ConnectionDebugInfo{})
	_, err := cb()
	if utilds.GetErrorCode(err) != ConnErrCode_UserInputReq {
		t.Fatalf("expected userinput-required error, got %v", err)
	}
	secret := "pw"
	cb = createPasswordCallbackPrompt(ctx, "host", &secret, &ConnectionDebugInfo{})
	got, err := cb()
	if err != nil || got != secret {
		t.Fatalf("stored password should still be used without prompting: %q %v", got, err)
	}
}

func TestHelperInstallPathQuotingKeepsDefaultPathUnchanged(t *testing.T) {
	if got := shellutil.SoftQuote(wavebase.RemoteFullGenieBinPath); got != wavebase.RemoteFullGenieBinPath {
		t.Fatalf("default helper path must stay unquoted so ~ expands, got %q", got)
	}
	if got := shellutil.SoftQuote("~/my tools/genie"); !strings.HasPrefix(got, "~") || !strings.Contains(got, "\"") {
		t.Fatalf("custom path with spaces should be quoted after ~, got %q", got)
	}
}

func TestCloseClientChainNil(t *testing.T) {
	if err := CloseClientChain(nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	settings := GetClientKeepAliveSettings(nil)
	if settings.CountMax != DefaultSshServerAliveCountMax {
		t.Fatalf("unexpected default settings: %+v", settings)
	}
}
