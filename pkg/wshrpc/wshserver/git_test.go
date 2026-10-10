// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestParseGitStatusPorcelain(t *testing.T) {
	resp := parseGitStatusPorcelain("## main...origin/main\x00 M file one.txt\x00?? 新文件.go\x00R  new-name.ts\x00old-name.ts\x00")
	if resp.Branch != "main" || resp.Upstream != "origin/main" {
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

func TestParseGitBranchHeader(t *testing.T) {
	tests := []struct {
		header   string
		branch   string
		upstream string
		ahead    int
		behind   int
		detached bool
	}{
		{header: "main...origin/main [ahead 1, behind 2]", branch: "main", upstream: "origin/main", ahead: 1, behind: 2},
		{header: "feat/x...origin/feat/x [behind 3]", branch: "feat/x", upstream: "origin/feat/x", behind: 3},
		{header: "main...origin/main [gone]", branch: "main", upstream: "origin/main"},
		{header: "main", branch: "main"},
		{header: "No commits yet on main", branch: "main"},
		{header: "HEAD (no branch)", detached: true},
	}
	for _, tc := range tests {
		rtn := &wshrpc.GitStatusResponse{}
		parseGitBranchHeader(rtn, tc.header)
		if rtn.Branch != tc.branch || rtn.Upstream != tc.upstream || rtn.Ahead != tc.ahead || rtn.Behind != tc.behind || rtn.Detached != tc.detached {
			t.Errorf("%q => %+v", tc.header, rtn)
		}
	}
}
