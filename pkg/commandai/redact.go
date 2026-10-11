// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"regexp"
	"strings"
)

var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?s)-----BEGIN (?:[A-Z0-9 ]* )?PRIVATE KEY-----.*?-----END (?:[A-Z0-9 ]* )?PRIVATE KEY-----`),
	regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`),
	regexp.MustCompile(`\b(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,})\b`),
	regexp.MustCompile(`\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{10,}\b`),
	regexp.MustCompile(`\bxox[abposr]-[A-Za-z0-9-]{10,}\b`),
	regexp.MustCompile(`\bAIza[A-Za-z0-9_-]{20,}\b`),
	regexp.MustCompile(`\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}\b`),
	regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b`),
}

var authPattern = regexp.MustCompile(`(?i)("?Authorization"?\s*:\s*["']?(?:Bearer|Basic)\s+)[^\s"'<>]+`)

var userinfoPattern = regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.-]*://)[^\s/@:]+:[^\s/@]*@`)

var assignmentPattern = regexp.MustCompile(`(?i)("?[A-Za-z_][A-Za-z0-9_.-]*"?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;\n}]+)`)

var flagPattern = regexp.MustCompile(`(?i)(--(?:password|passwd|token|api-key|secret|access-key|private-key|credential)(?:=|\s+))("[^"\n]*"|'[^'\n]*'|[^\s]+)`)

var sensitiveName = regexp.MustCompile(`(?i)(?:^|[_.-])(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)S?(?:$|[_.-])`)

var camelBoundary = regexp.MustCompile(`([a-z0-9])([A-Z])`)

func isSensitiveName(name string) bool {
	name = strings.ToUpper(camelBoundary.ReplaceAllString(name, "${1}_${2}"))
	if name == "PWD" {
		return false
	}
	for _, part := range []string{"PASSWORD", "PASSWD", "SECRET", "CREDENTIAL", "APIKEY", "API_KEY", "ACCESS_KEY", "PRIVATE_KEY"} {
		if strings.Contains(name, part) {
			return true
		}
	}
	return sensitiveName.MatchString(name)
}

func redactValue(s string, re *regexp.Regexp, count *int) string {
	return re.ReplaceAllStringFunc(s, func(v string) string {
		m := re.FindStringSubmatch(v)
		value := strings.Trim(m[2], "\"'")
		if value == "[REDACTED]" || value == "[REDACTED PRIVATE KEY]" {
			return v
		}
		*count++
		quote := ""
		if strings.HasPrefix(m[2], "\"") {
			quote = "\""
		} else if strings.HasPrefix(m[2], "'") {
			quote = "'"
		}
		return m[1] + quote + "[REDACTED]" + quote
	})
}

func Redact(s string) (string, int) {
	count := 0
	for i, re := range secretPatterns {
		s = re.ReplaceAllStringFunc(s, func(string) string {
			count++
			if i == 0 {
				return "[REDACTED PRIVATE KEY]"
			}
			return "[REDACTED]"
		})
	}
	s = authPattern.ReplaceAllStringFunc(s, func(v string) string {
		m := authPattern.FindStringSubmatch(v)
		if strings.TrimPrefix(v, m[1]) == "[REDACTED]" {
			return v
		}
		count++
		return m[1] + "[REDACTED]"
	})
	s = userinfoPattern.ReplaceAllStringFunc(s, func(v string) string { count++; return userinfoPattern.FindStringSubmatch(v)[1] + "[REDACTED]@" })
	s = assignmentPattern.ReplaceAllStringFunc(s, func(v string) string {
		m := assignmentPattern.FindStringSubmatch(v)
		key := strings.Trim(strings.TrimSpace(strings.TrimRight(strings.TrimSpace(m[1]), "=:")), "\"")
		if !isSensitiveName(key) {
			return v
		}
		return redactValue(v, assignmentPattern, &count)
	})
	s = redactValue(s, flagPattern, &count)
	return s, count
}
