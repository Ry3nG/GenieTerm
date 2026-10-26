// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package localconn

import (
	"crypto/sha256"
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

func currentUserSID() (string, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return "", fmt.Errorf("get local transport user: %w", err)
	}
	return user.User.Sid.String(), nil
}

func pipeName(socketPath, userSID string) (string, error) {
	if !filepath.IsAbs(socketPath) {
		return "", fmt.Errorf("local socket path must be absolute: %s", socketPath)
	}
	socketPath = filepath.Clean(socketPath)
	if directory, err := filepath.EvalSymlinks(filepath.Dir(socketPath)); err == nil {
		socketPath = filepath.Join(directory, filepath.Base(socketPath))
	}
	// Socket identifiers remain filesystem paths in tokens. Only the local Windows
	// transport maps them to a bounded, per-user pipe name.
	key := sha256.Sum256([]byte(userSID + "\x00" + strings.ToLower(socketPath)))
	return fmt.Sprintf(`\\.\pipe\genieterm-local-%x`, key), nil
}

func Listen(socketPath string) (net.Listener, error) {
	userSID, err := currentUserSID()
	if err != nil {
		return nil, err
	}
	name, err := pipeName(socketPath, userSID)
	if err != nil {
		return nil, err
	}
	return winio.ListenPipe(name, &winio.PipeConfig{
		SecurityDescriptor: "D:P(A;;GA;;;" + userSID + ")",
		InputBufferSize:    65536,
		OutputBufferSize:   65536,
	})
}

func Dial(socketPath string) (net.Conn, error) {
	userSID, err := currentUserSID()
	if err != nil {
		return nil, err
	}
	name, err := pipeName(socketPath, userSID)
	if err != nil {
		return nil, err
	}
	timeout := 2 * time.Second
	return winio.DialPipe(name, &timeout)
}
