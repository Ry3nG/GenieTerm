// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import "testing"

func TestExpandTruncatedCommand(t *testing.T) {
	cases := []struct {
		name   string
		comm   string
		path   string
		maxLen int
		want   string
	}{
		{"macOS helper", "Google Chrome He", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)", 16, "Google Chrome Helper (Renderer)"},
		{"linux daemon", "systemd-resolve", "/usr/lib/systemd/systemd-resolved", 15, "systemd-resolved"},
		{"short name untouched", "zsh", "/bin/zsh", 15, "zsh"},
		{"unrelated path kept", "python3.12-confi", "/usr/bin/python3", 16, "python3.12-confi"},
		{"empty path kept", "kworker/u16:2-ev", "", 16, "kworker/u16:2-ev"},
		{"exact length kept", "abcdefghijklmnop", "/bin/abcdefghijklmnop", 16, "abcdefghijklmnop"},
	}
	for _, tc := range cases {
		if got := expandTruncatedCommand(tc.comm, tc.path, tc.maxLen); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
