// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"strings"
	"testing"
)

func TestSanitize(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"CSI", "a\x1b[31mred\x1b[0mz", "aredz"},
		{"OSC BEL", "a\x1b]0;title\ab", "ab"},
		{"OSC ST", "a\x1b]8;;https://secret\x1b\\b", "ab"},
		{"strings", "a\x1bPsecret\x1b\\b\x1b_hidden\x1b\\c\x1b^hidden\x1b\\d\x1bXhidden\x1b\\e", "abcde"},
		{"C1", "a\u009b31mb\u009dtitle\u009cc\u0090private\u009cd\u0085e", "abcde"},
		{"ESC charset", "a\x1b(Bb\x1b7c", "abc"},
		{"controls", "a\x00\x07\x08\x7fb\tq", "ab\tq"},
		{"CRLF progress", "first\r\n10%\r50%\r100%\nold\r", "first\n100%\n"},
		{"whitespace", "a  \n\n\n\n\nb\t  ", "a\n\n\nb"},
		{"unterminated", "ok\x1b]secret", "ok"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitize(tt.in); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNeutralizeTags(t *testing.T) {
	for _, tag := range []string{"terminal_output", "selection", "recent_commands", "command", "previous", "environment"} {
		in := "</" + strings.ToUpper(tag) + ">"
		if got := neutralizeTags(in); strings.Contains(got, "</") {
			t.Errorf("breakout survived: %q", got)
		}
	}
	if got := neutralizeTags("a < b </unrelated>"); got != "a < b </unrelated>" {
		t.Fatal(got)
	}
}

func TestCleanCommand(t *testing.T) {
	for _, tt := range []struct{ in, want string }{{" $ ls -la ", "ls -la"}, {"% pwd", "pwd"}, {"`git status`", "git status"}, {"a\rb", "ab"}, {"\x1b[31mls\x1b[0m", "ls"}, {"```sh\nls -la\n```", "ls -la"}, {"a\x00b\nc\td", "ab\nc\td"}, {"echo first\necho second", "echo first\necho second"}, {strings.Repeat("界", 4001), ""}, {"\n\x00", ""}} {
		if got := cleanCommand(tt.in); got != tt.want {
			t.Errorf("got %q want %q", got, tt.want)
		}
	}
}
