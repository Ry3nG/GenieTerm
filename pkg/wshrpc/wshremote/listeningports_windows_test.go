// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"golang.org/x/sys/windows"
)

func TestWindowsListeningPortsNative(t *testing.T) {
	for _, tc := range []struct{ network, address string }{{"tcp4", "127.0.0.1:0"}, {"tcp6", "[::1]:0"}} {
		t.Run(tc.network, func(t *testing.T) {
			listener, err := net.Listen(tc.network, tc.address)
			if err != nil {
				if tc.network == "tcp6" {
					t.Skipf("IPv6 loopback unavailable: %v", err)
				}
				t.Fatal(err)
			}
			defer listener.Close()
			address := listener.Addr().(*net.TCPAddr)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			result, err := (&ServerImpl{}).RemoteListeningPortsCommand(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if result.Platform != "windows" {
				t.Fatalf("platform = %q", result.Platform)
			}
			var found *wshrpc.ListeningPort
			for i := range result.Ports {
				p := &result.Ports[i]
				if p.Port == address.Port && p.Address == address.IP.String() && p.Pid == int32(os.Getpid()) {
					found = p
					break
				}
			}
			if found == nil {
				t.Fatalf("own listener %s pid %d missing from %+v", address, os.Getpid(), result)
			}
			executable, _ := os.Executable()
			if found.Command != filepath.Base(executable) || found.User == "" {
				t.Fatalf("own listener identity missing: %+v", found)
			}
			t.Logf("native listener: %+v partial=%v", *found, result.Partial)
			client, err := net.DialTimeout(tc.network, listener.Addr().String(), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			accepted, err := listener.Accept()
			if err != nil {
				t.Fatal(err)
			}
			defer accepted.Close()
			clientPort := client.LocalAddr().(*net.TCPAddr).Port
			if err := listener.Close(); err != nil {
				t.Fatal(err)
			}
			result, err = (&ServerImpl{}).RemoteListeningPortsCommand(ctx)
			if err != nil {
				t.Fatal(err)
			}
			for _, p := range result.Ports {
				if p.Pid == int32(os.Getpid()) && (p.Port == address.Port || p.Port == clientPort) {
					t.Fatalf("closed listener or established-only socket reported: %+v", p)
				}
			}
		})
	}
}

func TestWindowsListeningPortsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := (&ServerImpl{}).RemoteListeningPortsCommand(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
}

func windowsTCPFixture(family uint32, pid uint32) []byte {
	rowSize := 24
	if family == windows.AF_INET6 {
		rowSize = 56
	}
	buffer := make([]byte, 4+rowSize)
	binary.LittleEndian.PutUint32(buffer[:4], 1)
	row := buffer[4:]
	if family == windows.AF_INET6 {
		row[15] = 1
		binary.BigEndian.PutUint16(row[20:], 54321)
		binary.LittleEndian.PutUint32(row[48:], windowsTCPStateListen)
		binary.LittleEndian.PutUint32(row[52:], pid)
	} else {
		binary.LittleEndian.PutUint32(row, windowsTCPStateListen)
		copy(row[4:8], []byte{127, 0, 0, 1})
		binary.BigEndian.PutUint16(row[8:], 54321)
		binary.LittleEndian.PutUint32(row[20:], pid)
	}
	return buffer
}

func TestWindowsTCPTableBoundsAndState(t *testing.T) {
	for _, family := range []uint32{windows.AF_INET, windows.AF_INET6} {
		fixture := windowsTCPFixture(family, 123)
		for _, size := range []int{0, 3, len(fixture) - 1} {
			if _, _, err := parseWindowsTCPTable(fixture[:size], family); err == nil {
				t.Fatalf("accepted truncated family %d table of size %d", family, size)
			}
		}
		ports, partial, err := parseWindowsTCPTable(fixture, family)
		if err != nil || partial || len(ports) != 1 || ports[0].Port != 54321 || ports[0].Pid != 123 {
			t.Fatalf("family %d ports=%+v partial=%v err=%v", family, ports, partial, err)
		}
		stateOffset := 4
		if family == windows.AF_INET6 {
			stateOffset += 48
		}
		binary.LittleEndian.PutUint32(fixture[stateOffset:], 5)
		if ports, _, err := parseWindowsTCPTable(fixture, family); err != nil || len(ports) != 0 {
			t.Fatalf("accepted established socket: %+v, %v", ports, err)
		}
	}
	buffer := make([]byte, 4+(listeningMaxSockets+1)*24)
	binary.LittleEndian.PutUint32(buffer, listeningMaxSockets+1)
	if _, partial, err := parseWindowsTCPTable(buffer, windows.AF_INET); err != nil || !partial {
		t.Fatalf("oversized table partial=%v err=%v", partial, err)
	}
}

func TestWindowsListeningPortsPartialFailure(t *testing.T) {
	result, err := collectWindowsListeningPorts(context.Background(), func(_ context.Context, family uint32) ([]byte, error) {
		if family == windows.AF_INET6 {
			return nil, windows.ERROR_ACCESS_DENIED
		}
		return windowsTCPFixture(family, uint32(os.Getpid())), nil
	})
	if err != nil || !result.Partial || len(result.Ports) != 1 || result.Ports[0].Pid != int32(os.Getpid()) {
		t.Fatalf("lost available family: result=%+v err=%v", result, err)
	}
	_, err = collectWindowsListeningPorts(context.Background(), func(context.Context, uint32) ([]byte, error) {
		return nil, windows.ERROR_ACCESS_DENIED
	})
	if !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		t.Fatalf("complete failure must remain an error: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err = collectWindowsListeningPorts(ctx, func(_ context.Context, family uint32) ([]byte, error) {
		cancel()
		return windowsTCPFixture(family, 0), nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("mid-scan cancellation lost: %v", err)
	}
	ports, partial, err := parseWindowsTCPTable(windowsTCPFixture(windows.AF_INET, 0), windows.AF_INET)
	if err != nil || !partial || len(ports) != 1 {
		t.Fatalf("unknown owner removed: ports=%+v partial=%v err=%v", ports, partial, err)
	}
}
