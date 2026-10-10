// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import "testing"

func TestParseOpts(t *testing.T) {
	cases := []struct {
		input string
		user  string
		host  string
		port  string
	}{
		{"paw-5090-ws", "", "paw-5090-ws", ""},
		{"zrgong@paw-5090-ws", "zrgong", "paw-5090-ws", ""},
		{"root@lab_gpu_box", "root", "lab_gpu_box", ""},
		{"root@lab_gpu_box:5559", "root", "lab_gpu_box", "5559"},
		{"first.last@host.example.com:22", "first.last", "host.example.com", "22"},
		{"10.0.0.5", "", "10.0.0.5", ""},
	}
	for _, c := range cases {
		opts, err := ParseOpts(c.input)
		if err != nil {
			t.Fatalf("ParseOpts(%q): %v", c.input, err)
		}
		if opts.SSHUser != c.user || opts.SSHHost != c.host || opts.SSHPort != c.port {
			t.Fatalf("ParseOpts(%q) = %+v", c.input, opts)
		}
	}
	for _, bad := range []string{"", "@host", "user@", "user@_host", "host:port", "user@host;rm"} {
		if _, err := ParseOpts(bad); err == nil {
			t.Fatalf("ParseOpts(%q) should fail", bad)
		}
	}
}
