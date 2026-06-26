// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { GitPanel } from "@/app/workspace/gitpanel";

const SampleDiff = `diff --git a/frontend/app/workspace/gitpanel.tsx b/frontend/app/workspace/gitpanel.tsx
--- a/frontend/app/workspace/gitpanel.tsx
+++ b/frontend/app/workspace/gitpanel.tsx
@@ -91,8 +91,11 @@
 const EmptyGraph = {
-    commits: [],
-    loading: false,
+    commits: sampleCommits,
+    loading: false,
+    error: "",
 };
 
diff --git a/pkg/wshrpc/wshserver/git.go b/pkg/wshrpc/wshserver/git.go
--- a/pkg/wshrpc/wshserver/git.go
+++ b/pkg/wshrpc/wshserver/git.go
@@ -88,7 +88,7 @@
-    if limit <= 0 || limit > GitGraphMaxLimit {
+    if limit <= 0 {
         limit = GitGraphDefaultLimit
     }
`;

const SampleFiles: GitStatusFile[] = [
    { index: "U", worktree: "U", path: "frontend/app/workspace/gitpanel.tsx" },
    { index: "M", worktree: " ", path: "pkg/wshrpc/wshserver/git.go" },
    { index: "A", worktree: " ", path: "frontend/app/workspace/gitpanel.test.ts" },
    { index: " ", worktree: "M", path: "frontend/app/view/codeeditor/diffviewer.tsx" },
    { index: "?", worktree: "?", path: "docs/visual-qa/git-panel-notes.md" },
    {
        index: "R",
        worktree: " ",
        path: "frontend/app/workspace/source-control.tsx",
        origpath: "frontend/app/workspace/gitpanel-old.tsx",
    },
];

const SampleCommits: GitGraphCommit[] = [
    {
        hash: "0dfe49c123456789",
        shorthash: "0dfe49c",
        parents: ["a7a990c123456789"],
        refs: ["HEAD -> feat/kairos-streaming-memory", "origin/feat/kairos-streaming-memory"],
        subject: "MemoryWAM-core B1: all-video action mask for mixed-tpf cache",
        author: "GONG ZERUI",
        reldate: "1 hour ago",
        timestamp: 1782460800,
        graph: "*",
    },
    {
        hash: "a7a990c123456789",
        shorthash: "a7a990c",
        parents: ["4d63f0b123456789", "bb30669123456789"],
        refs: [],
        subject: "MemoryWAM-core enablers: masked KV route and branch-stable cache",
        author: "GONG ZERUI",
        reldate: "2 hours ago",
        timestamp: 1782457200,
        graph: "*",
    },
    {
        hash: "4d63f0b123456789",
        shorthash: "4d63f0b",
        parents: ["79e94a5123456789"],
        refs: ["origin/main"],
        subject: "MemoryWAM Run-1 16-GPU recipe with explicit validation",
        author: "GONG ZERUI",
        reldate: "today",
        timestamp: 1782453600,
        graph: "| *",
    },
    {
        hash: "bb30669123456789",
        shorthash: "bb30669",
        parents: ["79e94a5123456789"],
        refs: ["codex/git-panel-polish"],
        subject: "Polish Git panel graph density and diff readability",
        author: "Codex",
        reldate: "today",
        timestamp: 1782450000,
        graph: "* |",
    },
    {
        hash: "79e94a5123456789",
        shorthash: "79e94a5",
        parents: ["220a161123456789"],
        refs: [],
        subject: "Step-1 16-GPU: M=2 K=1 train-short, no TBPTT",
        author: "GONG ZERUI",
        reldate: "yesterday",
        timestamp: 1782367200,
        graph: "*",
    },
    {
        hash: "220a161123456789",
        shorthash: "220a161",
        parents: [],
        refs: ["tag: v0.4.53"],
        subject: "Step-1 16-GPU: DeepSpeed ZeRO-1 optimizer sharding baseline",
        author: "GONG ZERUI",
        reldate: "yesterday",
        timestamp: 1782363600,
        graph: "*",
    },
];

const CommitFiles = [
    { status: "M", path: "frontend/app/workspace/gitpanel.tsx" },
    { status: "A", path: "frontend/app/workspace/gitpanel.test.ts" },
    { status: "M", path: "pkg/wshrpc/wshserver/git.go" },
    {
        status: "R100",
        path: "frontend/app/workspace/source-control.tsx",
        origpath: "frontend/app/workspace/gitpanel-old.tsx",
    },
];

export default function GitPanelPreview() {
    return (
        <div className="flex w-full flex-col gap-6 px-6">
            <div className="flex min-h-[720px] flex-col gap-4 2xl:flex-row">
                <GitPanel
                    open
                    onClose={() => {}}
                    previewData={{
                        cwd: "/Users/mike/projects/GenieTerm",
                        activeTab: "changes",
                        status: {
                            branch: "feat/git-panel-polish...origin/feat/git-panel-polish [ahead 1]",
                            files: SampleFiles,
                        },
                        preview: {
                            title: "frontend/app/workspace/gitpanel.tsx",
                            args: [],
                            content: SampleDiff,
                            error: "",
                            loading: false,
                            kind: "diff",
                        },
                    }}
                />
                <GitPanel
                    open
                    onClose={() => {}}
                    previewData={{
                        cwd: "/Users/mike/projects/GenieTerm",
                        activeTab: "graph",
                        status: {
                            branch: "feat/git-panel-polish...origin/feat/git-panel-polish [ahead 1]",
                            files: SampleFiles,
                        },
                        graph: {
                            commits: SampleCommits,
                        },
                        selectedHash: SampleCommits[2].hash,
                        commitFiles: {
                            hash: SampleCommits[2].hash,
                            files: CommitFiles,
                            loading: false,
                            error: "",
                        },
                        pendingCheckout: {
                            hash: SampleCommits[2].hash,
                            shorthash: SampleCommits[2].shorthash,
                            subject: SampleCommits[2].subject,
                            target: SampleCommits[2].hash,
                        },
                    }}
                />
            </div>
            <div className="flex min-h-[360px] flex-col gap-4 xl:flex-row">
                <GitPanel
                    open
                    onClose={() => {}}
                    previewData={{
                        cwd: "/Users/mike/projects/clean-repo",
                        status: {
                            branch: "main...origin/main",
                            files: [],
                        },
                    }}
                />
                <GitPanel
                    open
                    onClose={() => {}}
                    previewData={{
                        cwd: "/Users/mike/projects/not-a-repo",
                        status: {
                            error: "fatal: not a git repository (or any of the parent directories): .git",
                            exitcode: 128,
                            files: [],
                        },
                    }}
                />
            </div>
        </div>
    );
}
