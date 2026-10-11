// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

const responseSchema = `{"type":"object","additionalProperties":false,"required":["summary","proposals"],"properties":{"summary":{"type":"string"},"proposals":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["command","explanation"],"properties":{"command":{"type":"string"},"explanation":{"type":"string"}}}}}}`

var plainCommand = regexp.MustCompile(`^(?:\$ |% )?(?:\./[^\s]+|/[\w/.-]+|(?:ls|find|du|df|pwd|cat|head|tail|grep|rg|git|npm|pnpm|yarn|go|python3?|pip3?|docker|kubectl|ps|top|sort|uniq|wc|sed|awk|which|file|stat|uname|echo|printf|cd|mkdir|cp|mv|rm|chmod|curl|wget|tar|ssh|brew|apt|dnf|pacman|sudo))(?:\s|$)`)

var plainProse = regexp.MustCompile(`(?i)^\S+\s+(?:is|are|can|will|would|should|lets|allows|lists|shows|prints|means|command)\b`)

func parseResponse(s, task string) (string, []wshrpc.CommandAiProposal) {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s[i+1:]), "```"))
		}
	}
	var value any
	err := json.Unmarshal([]byte(s), &value)
	summary := ""
	var raw []any
	if err == nil {
		switch v := value.(type) {
		case map[string]any:
			summary, _ = v["summary"].(string)
			raw, _ = v["proposals"].([]any)
			if raw == nil {
				raw, _ = v["commands"].([]any)
			}
		case []any:
			raw = v
		}
	} else if task == TaskCompose {
		for _, line := range strings.Split(s, "\n") {
			line = strings.TrimSpace(line)
			if plainCommand.MatchString(line) && !plainProse.MatchString(line) && !strings.Contains(line, "```") {
				raw = append(raw, line)
			}
		}
	}
	seen := map[string]bool{}
	var proposals []wshrpc.CommandAiProposal
	for _, v := range raw {
		var p wshrpc.CommandAiProposal
		switch v := v.(type) {
		case string:
			p.Command = v
		case map[string]any:
			p.Command, _ = v["command"].(string)
			p.Explanation, _ = v["explanation"].(string)
		}
		p.Command = cleanCommand(p.Command)
		if p.Command == "" || seen[p.Command] {
			continue
		}
		seen[p.Command] = true
		p.Explanation = limit(strings.TrimSpace(cleanText(strings.ReplaceAll(p.Explanation, "\n", " "), false)), 300)
		proposals = append(proposals, p)
		if len(proposals) == 3 {
			break
		}
	}
	return limit(strings.TrimSpace(cleanText(summary, true)), 1500), proposals
}
