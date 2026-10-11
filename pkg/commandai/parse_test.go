// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseResponse(t *testing.T) {
	for _, tt := range []struct {
		name, input, task, summary string
		commands                   []string
	}{
		{"codex", `{"proposals":[{"command":"find . -type f -size +104857600c","explanation":"Find files ..."}]}`, TaskCompose, "", []string{"find . -type f -size +104857600c"}},
		{"fence", "```json\n{\"summary\":\"ok\",\"proposals\":[{\"command\":\"ls\"}]}\n```", TaskCompose, "ok", []string{"ls"}},
		{"array", `["ls",{"command":"pwd"}]`, TaskCompose, "", []string{"ls", "pwd"}},
		{"commands", `{"commands":["$ ls","ls","pwd","git status","du -sh ."]}`, TaskCompose, "", []string{"ls", "pwd", "git status"}},
		{"plain", "Here are commands:\n# commentary\nls -la\nYou can use find.\ngit is a version control tool\nfind .\npwd", TaskCompose, "", []string{"ls -la", "find .", "pwd"}},
		{"plain fix", "ls -la", TaskFix, "", nil},
		{"explain", `{"summary":"This lists files.\nIt is read only.","proposals":[]}`, TaskExplain, "This lists files.\nIt is read only.", nil},
		{"bad JSON", `{"proposals":`, TaskCompose, "", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			summary, ps := parseResponse(tt.input, tt.task)
			if summary != tt.summary || len(ps) != len(tt.commands) {
				t.Fatalf("got %q, %+v", summary, ps)
			}
			for i, p := range ps {
				if p.Command != tt.commands[i] {
					t.Fatal(p.Command)
				}
			}
		})
	}
	long := map[string]any{"summary": strings.Repeat("界", 1600) + "\x00", "proposals": []map[string]string{{"command": "ls", "explanation": strings.Repeat("界", 400) + "\n\x00"}, {"command": strings.Repeat("x", 4001)}}}
	data, _ := json.Marshal(long)
	summary, ps := parseResponse(string(data), TaskCompose)
	if len([]rune(summary)) != 1500 || len(ps) != 1 || len([]rune(ps[0].Explanation)) != 300 {
		t.Fatal("limits not enforced")
	}
}

func TestSchema(t *testing.T) {
	var schema map[string]any
	if err := json.Unmarshal([]byte(responseSchema), &schema); err != nil {
		t.Fatal(err)
	}
	var check func(map[string]any)
	check = func(s map[string]any) {
		if _, ok := s["maxItems"]; ok {
			t.Fatal("unsupported maxItems")
		}
		if s["type"] == "object" {
			props := s["properties"].(map[string]any)
			if s["additionalProperties"] != false || len(s["required"].([]any)) != len(props) {
				t.Fatal("non-strict schema")
			}
			for _, p := range props {
				check(p.(map[string]any))
			}
		}
		if s["type"] == "array" {
			check(s["items"].(map[string]any))
		}
	}
	check(schema)
}
