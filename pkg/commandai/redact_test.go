// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import "testing"

func TestRedact(t *testing.T) {
	tests := []struct {
		name, in, want string
		count          int
	}{
		{"PEM", "before\n-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----\nafter", "before\n[REDACTED PRIVATE KEY]\nafter", 1},
		{"AWS id", "AKIA0123456789ABCDEF ASIA0123456789ABCDEF", "[REDACTED] [REDACTED]", 2},
		{"AWS secret", "aws_secret_access_key = abcdef", "aws_secret_access_key = [REDACTED]", 1},
		{"GitHub", "ghp_abcdefghijklmnop github_pat_abcdefghijklmnop", "[REDACTED] [REDACTED]", 2},
		{"AI", "sk-abcdefghijklm sk-ant-abcdefghijklm sk-proj-abcdefghijklm", "[REDACTED] [REDACTED] [REDACTED]", 3},
		{"Slack", "xoxb-1234567890-abcd", "[REDACTED]", 1},
		{"Google", "AIza12345678901234567890123456789012345", "[REDACTED]", 1},
		{"Stripe", "rk_live_abcdefghijklm sk_test_abcdefghijklm", "[REDACTED] [REDACTED]", 2},
		{"JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature", "[REDACTED]", 1},
		{"auth", "Authorization: Bearer abc123\nAuthorization: Basic dXNlcjpwYXNz", "Authorization: Bearer [REDACTED]\nAuthorization: Basic [REDACTED]", 2},
		{"JSON auth", `"Authorization": "Bearer private"`, `"Authorization": "Bearer [REDACTED]"`, 1},
		{"URL", "https://user:pass@example.com/path", "https://[REDACTED]@example.com/path", 1},
		{"assignments", `DB_PASSWORD=abc PASSWORD: abc "api_key": "abc def"`, `DB_PASSWORD=[REDACTED] PASSWORD: [REDACTED] "api_key": "[REDACTED]"`, 3},
		{"key parts", "DB_PWD=x PRIVATE_KEY='a b' CREDENTIALS: value APIKEY=x ACCESS_KEY=x PASSWD=x", "DB_PWD=[REDACTED] PRIVATE_KEY='[REDACTED]' CREDENTIALS: [REDACTED] APIKEY=[REDACTED] ACCESS_KEY=[REDACTED] PASSWD=[REDACTED]", 6},
		{"flags", `--password=x --token y --api-key "abc def"`, `--password=[REDACTED] --token [REDACTED] --api-key "[REDACTED]"`, 3},
		{"camel case", `"accessToken": "private" dbPassword=x`, `"accessToken": "[REDACTED]" dbPassword=[REDACTED]`, 2},
		{"marker injection", `PASSWORD="prefix[REDACTED]suffix"`, `PASSWORD="[REDACTED]"`, 1},
		{"cwd", "PWD=/home/x", "PWD=/home/x", 0},
		{"tokenizer", "TOKENIZER_PATH=/x", "TOKENIZER_PATH=/x", 0},
		{"word", "task-abcdefghijklmnop mask-abcdefghijklmnop", "task-abcdefghijklmnop mask-abcdefghijklmnop", 0},
		{"ids", "abc123def456789012345678901234567890123456 550e8400-e29b-41d4-a716-446655440000", "abc123def456789012345678901234567890123456 550e8400-e29b-41d4-a716-446655440000", 0},
		{"base64", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", 0},
		{"single replacement", "API_KEY=sk-abcdefghijklm", "API_KEY=[REDACTED]", 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, count := Redact(tt.in)
			if got != tt.want || count != tt.count {
				t.Fatalf("got %q (%d), want %q (%d)", got, count, tt.want, tt.count)
			}
		})
	}
}
