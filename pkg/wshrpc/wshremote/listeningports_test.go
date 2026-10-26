// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestProcAddress(t *testing.T) {
	for _, tc := range []struct {
		input, address string
		port           int
	}{
		{"0100007F:1538", "127.0.0.1", 5432}, {"00000000:1F90", "0.0.0.0", 8080},
		{"00000000000000000000000001000000:0BB8", "::1", 3000},
		{"0000000000000000FFFF00000100007F:1F90", "::ffff:127.0.0.1", 8080},
		{"B80D0120000000000000000001000000:01BB", "2001:db8::1", 443},
		{"0100007F:10000", "", 0}, {"0100007F:0000", "", 0}, {"GG00007F:1234", "", 0}, {"123:1234", "", 0}, {"missing", "", 0},
	} {
		t.Run(tc.input, func(t *testing.T) {
			address, port, ok := parseProcAddress(tc.input)
			if address != tc.address || port != tc.port || ok != (tc.port != 0) {
				t.Fatalf("got %q %d %v", address, port, ok)
			}
		})
	}
}

func TestProcListeningPorts(t *testing.T) {
	for _, tc := range []struct {
		name   string
		want   []wshrpc.ListeningPort
		inodes []string
	}{
		{"tcp", []wshrpc.ListeningPort{{Address: "127.0.0.1", Port: 5432}, {Address: "0.0.0.0", Port: 8080}, {Address: "0.0.0.0", Port: 8080}, {Address: "0.0.0.0", Port: 80}}, []string{"111", "222", "333", "666"}},
		{"tcp6", []wshrpc.ListeningPort{{Address: "::1", Port: 3000}, {Address: "::ffff:127.0.0.1", Port: 8080}, {Address: "::", Port: 443}}, []string{"777", "888", "999"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ports, inodes := parseProcListeningPorts(hostFixture(t, tc.name))
			if !reflect.DeepEqual(ports, tc.want) || !reflect.DeepEqual(inodes, tc.inodes) {
				t.Fatalf("ports=%+v inodes=%v", ports, inodes)
			}
		})
	}
	for _, text := range []string{"", "header", "0: 0100007F:1538 0 0A 0 0 0 0 0 notinode"} {
		ports, _ := parseProcListeningPorts(text)
		if len(ports) != 0 {
			t.Fatalf("accepted %q", text)
		}
	}
}

func TestLsofAddress(t *testing.T) {
	for _, tc := range []struct {
		text, family, address string
		port                  int
	}{
		{"*:8080", "IPv4", "0.0.0.0", 8080}, {"*:8080", "IPv6", "::", 8080}, {"[::1]:3000", "IPv6", "::1", 3000},
		{"127.0.0.1:5432", "IPv4", "127.0.0.1", 5432}, {"[::ffff:127.0.0.1]:80", "IPv6", "::ffff:127.0.0.1", 80},
		{"*:8080", "", "", 0}, {"localhost:80", "IPv4", "", 0}, {"*:99999", "IPv4", "", 0}, {"*:0", "IPv4", "", 0}, {"bad", "IPv4", "", 0},
	} {
		t.Run(tc.text+tc.family, func(t *testing.T) {
			address, port, ok := parseLsofAddress(tc.text, tc.family)
			if address != tc.address || port != tc.port || ok != (tc.port != 0) {
				t.Fatalf("got %q %d %v", address, port, ok)
			}
		})
	}
}

func TestLsofListeningPorts(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		want       []wshrpc.ListeningPort
	}{
		{"fixture", hostFixture(t, "lsof.txt"), []wshrpc.ListeningPort{
			{Pid: 125, Command: "unreadable-login", Address: "0.0.0.0", Port: 80},
			{Pid: 123, Command: "web server", User: "alice", Address: "::1", Port: 3000},
			{Pid: 124, Command: "worker", User: "bob", Address: "127.0.0.1", Port: 5432},
			{Pid: 123, Command: "web server", User: "alice", Address: "0.0.0.0", Port: 8080},
			{Pid: 124, Command: "worker", User: "bob", Address: "0.0.0.0", Port: 8080},
			{Pid: 123, Command: "web server", User: "alice", Address: "::", Port: 8080},
			{Pid: 123, Command: "web server", User: "alice", Address: "::ffff:127.0.0.1", Port: 8081},
		}},
		{"field order", "p1\nccommand\nf1\nn*:80\ntIPv6", []wshrpc.ListeningPort{{Pid: 1, Command: "command", Address: "::", Port: 80}}},
		{"invalid pid", "pbad\nccommand\nf1\ntIPv4\nn*:80", []wshrpc.ListeningPort{}},
		{"empty", "", []wshrpc.ListeningPort{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ports := normalizeListeningPorts(parseLsofListeningPorts(tc.text))
			if !reflect.DeepEqual(ports, tc.want) {
				t.Fatalf("got %+v want %+v", ports, tc.want)
			}
		})
	}
}

func TestSocketInodeAndPID(t *testing.T) {
	for _, tc := range []struct{ text, want string }{{"socket:[123]", "123"}, {"socket:[0]", "0"}, {"socket:[nope]", ""}, {"socket:[123", ""}, {"pipe:[123]", ""}, {"socket:[]", ""}} {
		if got := parseSocketInode(tc.text); got != tc.want {
			t.Fatalf("%q got %q", tc.text, got)
		}
	}
	for _, tc := range []struct {
		text string
		want int32
	}{{"123", 123}, {"+1", 0}, {"self", 0}, {"-1", 0}, {"", 0}, {"999999999999999", 0}} {
		if got := numericPID(tc.text); got != tc.want {
			t.Fatalf("%q got %d", tc.text, got)
		}
	}
}

func TestSocketOwnerScan(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Linux /proc file-descriptor symlinks are unavailable on native Windows")
	}
	for _, tc := range []struct {
		name    string
		cancel  bool
		ids     []string
		want    map[string]int32
		partial bool
	}{
		{"reuseport", false, []string{"111", "222", "333"}, map[string]int32{"111": 123, "222": 123, "333": 124}, false},
		{"unreadable owner", false, []string{"111", "666"}, map[string]int32{"111": 123}, true},
		{"cancelled", true, []string{"111"}, map[string]int32{}, true},
		{"empty", false, nil, map[string]int32{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			for _, p := range []struct {
				pid int
				ids []string
			}{{123, []string{"111", "222"}}, {124, []string{"333"}}} {
				dir := filepath.Join(root, fmt.Sprint(p.pid), "fd")
				if err := os.MkdirAll(dir, 0700); err != nil {
					t.Fatal(err)
				}
				for fd, id := range p.ids {
					if err := os.Symlink("socket:["+id+"]", filepath.Join(dir, fmt.Sprint(fd))); err != nil {
						t.Fatal(err)
					}
				}
			}
			// A missing fd directory models hidepid, permission denial, and exited owners without requiring root.
			if err := os.Mkdir(filepath.Join(root, "999"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Join(root, "self"), 0700); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if tc.cancel {
				cancel()
			}
			owners := mapSocketOwners(ctx, root, tc.ids)
			if !reflect.DeepEqual(owners, tc.want) {
				t.Fatalf("owners=%v want=%v", owners, tc.want)
			}
			ports := make([]wshrpc.ListeningPort, len(tc.ids))
			if partial := fillSocketOwners(ports, tc.ids, owners); partial != tc.partial {
				t.Fatalf("partial=%v", partial)
			}
		})
	}
}

func TestLinuxListeningPartial(t *testing.T) {
	for _, tc := range []struct {
		name   string
		files  bool
		cancel bool
	}{{"unmapped", true, false}, {"unreadable tables", false, false}, {"budget exhausted", true, true}} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.Mkdir(filepath.Join(root, "net"), 0700); err != nil {
				t.Fatal(err)
			}
			if tc.files {
				for _, name := range []string{"tcp", "tcp6"} {
					if err := os.WriteFile(filepath.Join(root, "net", name), []byte(hostFixture(t, name)), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.cancel {
				cancel()
			}
			result, err := linuxListeningPorts(ctx, root)
			if err != nil || !result.Partial {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if tc.files && !tc.cancel && len(result.Ports) != 7 {
				t.Fatalf("lost unknown owners: %v", result.Ports)
			}
		})
	}
}
