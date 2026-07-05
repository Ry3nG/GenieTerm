// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package codexcompose

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAuthStatusRequiresLoginWhenAuthFileMissing(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	status := AuthStatus()

	if status.Available {
		t.Fatalf("expected missing auth to be unavailable")
	}
	if status.Code != StatusLoginRequired {
		t.Fatalf("expected status %q, got %q", StatusLoginRequired, status.Code)
	}
	if status.LoginCommand != "codex login" {
		t.Fatalf("expected login command, got %q", status.LoginCommand)
	}
	if status.InstallCommand == "" {
		t.Fatalf("expected install command")
	}
}

func TestAuthStatusRequiresLoginWhenAuthFileIsIncomplete(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	authDir := filepath.Join(home, ".codex")
	if err := os.MkdirAll(authDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(authDir, "auth.json"), []byte(`{"tokens":{"access_token":"token"}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	status := AuthStatus()

	if status.Available {
		t.Fatalf("expected incomplete auth to be unavailable")
	}
	if status.Code != StatusLoginRequired {
		t.Fatalf("expected status %q, got %q", StatusLoginRequired, status.Code)
	}
	if status.Message == "" {
		t.Fatalf("expected actionable message")
	}
}

func TestStatusForComposeErrorMarksExpiredOauthSession(t *testing.T) {
	status := StatusForComposeError(os.ErrPermission)
	if status.Code != StatusRequestFailed {
		t.Fatalf("expected generic request failure, got %q", status.Code)
	}

	expired := StatusForComposeError(errCodexUnauthorized)
	if expired.Code != StatusExpired {
		t.Fatalf("expected expired status, got %q", expired.Code)
	}
	if expired.LoginCommand != "codex login" {
		t.Fatalf("expected login command, got %q", expired.LoginCommand)
	}
}
