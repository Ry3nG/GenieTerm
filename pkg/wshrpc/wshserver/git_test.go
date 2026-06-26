// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import "testing"

func TestNormalizeGitGraphLimit(t *testing.T) {
	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{name: "default", limit: 0, want: GitGraphDefaultLimit},
		{name: "negative", limit: -1, want: GitGraphDefaultLimit},
		{name: "inside max", limit: 120, want: 120},
		{name: "clamps above max", limit: 250, want: GitGraphMaxLimit},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeGitGraphLimit(tc.limit); got != tc.want {
				t.Fatalf("normalizeGitGraphLimit(%d) = %d, want %d", tc.limit, got, tc.want)
			}
		})
	}
}

func TestParseGitStatusPorcelain(t *testing.T) {
	resp := parseGitStatusPorcelain("## main...origin/main\x00 M file one.txt\x00?? 新文件.go\x00R  new-name.ts\x00old-name.ts\x00")
	if resp.Branch != "main...origin/main" {
		t.Fatalf("branch = %q", resp.Branch)
	}
	if len(resp.Files) != 3 {
		t.Fatalf("file count = %d", len(resp.Files))
	}
	if resp.Files[0].Worktree != "M" || resp.Files[0].Path != "file one.txt" {
		t.Fatalf("modified file = %#v", resp.Files[0])
	}
	if resp.Files[1].Index != "?" || resp.Files[1].Worktree != "?" || resp.Files[1].Path != "新文件.go" {
		t.Fatalf("untracked file = %#v", resp.Files[1])
	}
	if resp.Files[2].Index != "R" || resp.Files[2].Path != "new-name.ts" || resp.Files[2].OrigPath != "old-name.ts" {
		t.Fatalf("renamed file = %#v", resp.Files[2])
	}
}

func TestParseGitGraph(t *testing.T) {
	resp := parseGitGraph("* \x1fabc123456789\x1fabc1234\x1fdef999 aaa111\x1fHEAD -> main, origin/main, tag: v1\x1fAda\x1f2 hours ago\x1f1760000000\x1fMerge branch\n| * \x1fdef999\x1fdef999\x1f\x1ffeat/git\x1fGrace\x1fyesterday\x1f1759999999\x1fAdd graph\n|/\n")
	if len(resp.Commits) != 2 {
		t.Fatalf("commit count = %d", len(resp.Commits))
	}
	if resp.Commits[0].Hash != "abc123456789" || resp.Commits[0].ShortHash != "abc1234" {
		t.Fatalf("first commit hash = %#v", resp.Commits[0])
	}
	if len(resp.Commits[0].Parents) != 2 || resp.Commits[0].Parents[1] != "aaa111" {
		t.Fatalf("first commit parents = %#v", resp.Commits[0].Parents)
	}
	if len(resp.Commits[0].Refs) != 3 || resp.Commits[0].Refs[0] != "HEAD -> main" {
		t.Fatalf("first commit refs = %#v", resp.Commits[0].Refs)
	}
	if resp.Commits[1].Graph != "| *" || resp.Commits[1].Subject != "Add graph" {
		t.Fatalf("second commit = %#v", resp.Commits[1])
	}
}
