// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"regexp"
	"strings"
	"unicode"
)

var closingTags = regexp.MustCompile(`(?i)</(terminal_output|selection|recent_commands|command|previous|environment)`)

func neutralizeTags(s string) string { return closingTags.ReplaceAllString(s, "< /$1") }

func sanitize(s string) string {
	r := []rune(strings.ReplaceAll(s, "\r\n", "\n"))
	var b strings.Builder
	for i := 0; i < len(r); i++ {
		c := r[i]
		if c == 0x1b || c == 0x9b || c == 0x9d || c == 0x90 || c == 0x98 || c == 0x9e || c == 0x9f {
			kind := c
			if c == 0x1b {
				i++
				if i >= len(r) {
					break
				}
				kind = r[i]
			}
			if kind == '[' || kind == 0x9b {
				for i++; i < len(r); i++ {
					if r[i] >= 0x40 && r[i] <= 0x7e {
						break
					}
				}
			} else if strings.ContainsRune("]PX^_", kind) || kind == 0x9d || kind == 0x90 || kind == 0x98 || kind == 0x9e || kind == 0x9f {
				for i++; i < len(r); i++ {
					if r[i] == 0x9c || ((kind == ']' || kind == 0x9d) && r[i] == 7) {
						break
					}
					if r[i] == 0x1b && i+1 < len(r) && r[i+1] == '\\' {
						i++
						break
					}
				}
			} else {
				for kind >= 0x20 && kind <= 0x2f && i+1 < len(r) {
					i++
					kind = r[i]
				}
			}
			continue
		}
		if (c < 32 && c != '\n' && c != '\t' && c != '\r') || (c >= 127 && c <= 159) {
			continue
		}
		b.WriteRune(c)
	}
	lines := strings.Split(b.String(), "\n")
	out := make([]string, 0, len(lines))
	blanks := 0
	for _, line := range lines {
		if p := strings.LastIndexByte(line, '\r'); p >= 0 {
			line = line[p+1:]
		}
		line = strings.TrimRight(line, " \t")
		if line == "" {
			blanks++
			if blanks > 2 {
				continue
			}
		} else {
			blanks = 0
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func cleanText(s string, keepNewlines bool) string {
	return strings.Map(func(r rune) rune {
		if r == '\t' || (keepNewlines && r == '\n') {
			return r
		}
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s)
}

func limit(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func cleanCommand(s string) string {
	s = strings.TrimSpace(sanitize(strings.ReplaceAll(s, "\r", "")))
	if strings.HasPrefix(s, "```") && strings.HasSuffix(s, "```") {
		s = strings.TrimSuffix(s, "```")
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = s[i+1:]
		} else {
			s = strings.TrimPrefix(s, "```")
		}
	}
	s = strings.Trim(strings.TrimSpace(s), "`")
	// A multi-line answer stays multi-line: joining the lines would change the command,
	// and the sheet only inserts multi-line text through bracketed paste.
	s = strings.TrimSpace(cleanText(s, true))
	if strings.HasPrefix(s, "$ ") || strings.HasPrefix(s, "% ") {
		s = strings.TrimSpace(s[2:])
	}
	if len([]rune(s)) > 4000 {
		return ""
	}
	return s
}
