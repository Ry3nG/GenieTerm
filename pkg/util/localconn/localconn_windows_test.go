// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package localconn

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsLongUnicodeSocketTransportAndIsolation(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), strings.Repeat("用户资料", 50), "space and unicode 数据", "wave.sock")
	listener, err := Listen(socketPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	client, server := connectPair(t, listener, strings.ToUpper(socketPath))
	assertRoundTrip(t, client, server, "first 数据 \x00 message")

	if duplicate, err := Listen(socketPath); err == nil {
		duplicate.Close()
		t.Fatal("a second listener took over the same user/profile endpoint")
	}
	otherPath := filepath.Join(filepath.Dir(socketPath), "another profile", "wave.sock")
	otherListener, err := Listen(otherPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { otherListener.Close() })
	otherClient, otherServer := connectPair(t, otherListener, otherPath)
	assertRoundTrip(t, otherClient, otherServer, "second profile")
	assertRoundTrip(t, client, server, "first profile remains independent")

	handle := windows.Handle(server.(interface{ Fd() uintptr }).Fd())
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_KERNEL_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	userSID, err := currentUserSID()
	if err != nil {
		t.Fatal(err)
	}
	sddl := descriptor.String()
	if strings.Count(sddl, "(A;") != 1 || !strings.Contains(sddl, ";;;"+userSID+")") {
		t.Fatalf("pipe ACL must grant access only to current user: %s", sddl)
	}
}

func TestWindowsPipeNamesUseUserAndNormalizedProfile(t *testing.T) {
	first, err := pipeName(`C:\Users\用户\AppData\GenieTerm\wave.sock`, "S-1-5-21-1")
	if err != nil {
		t.Fatal(err)
	}
	equivalent, err := pipeName(`c:/users/用户/appdata/GenieTerm/./WAVE.SOCK`, "S-1-5-21-1")
	if err != nil || equivalent != first {
		t.Fatalf("equivalent profile changed pipe: %q, %q (%v)", first, equivalent, err)
	}
	otherUser, _ := pipeName(`C:\Users\用户\AppData\GenieTerm\wave.sock`, "S-1-5-21-2")
	if otherUser == first {
		t.Fatal("different users share a pipe namespace")
	}
	if !strings.HasPrefix(first, `\\.\pipe\genieterm-local-`) || len(first) > 100 {
		t.Fatalf("pipe name is not bounded: %q", first)
	}
	if _, err := pipeName("wave.sock", "S-1-5-21-1"); err == nil {
		t.Fatal("relative socket path accepted")
	}
}
