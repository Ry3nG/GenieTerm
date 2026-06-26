// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    checkoutTargetForCommit,
    fileDiffArgs,
    makeGraphRenderModel,
    parseCommitFiles,
    parseUnifiedDiff,
} from "./gitpanel";

function commit(overrides: Partial<GitGraphCommit>): GitGraphCommit {
    return {
        hash: "abc123456789",
        shorthash: "abc1234",
        parents: [],
        refs: [],
        subject: "Subject",
        author: "Ada",
        reldate: "today",
        timestamp: 1760000000,
        graph: "*",
        ...overrides,
    };
}

describe("gitpanel helpers", () => {
    it("uses git no-index for untracked file diffs without treating exit 1 as failure", () => {
        const diff = fileDiffArgs({ index: "?", worktree: "?", path: "new file.txt" }, "changes");

        expect(diff.args).toEqual([
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--unified=8",
            "--no-index",
            "--",
            "/dev/null",
            "new file.txt",
        ]);
        expect(diff.allowExitCodes).toEqual([0, 1]);
    });

    it("parses renamed commit file lists", () => {
        expect(parseCommitFiles("M\tapp.ts\nR100\told.ts\tnew.ts\n")).toEqual([
            { status: "M", path: "app.ts" },
            { status: "R100", origpath: "old.ts", path: "new.ts" },
        ]);
    });

    it("parses unified diffs into line-numbered rows", () => {
        const files = parseUnifiedDiff(
            "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -2,2 +2,2 @@\n const old = 1;\n-old\n+new\n"
        );

        expect(files).toHaveLength(1);
        expect(files[0].oldPath).toBe("app.ts");
        expect(files[0].newPath).toBe("app.ts");
        expect(files[0].lines).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "context", oldLine: 2, newLine: 2, text: "const old = 1;" }),
                expect.objectContaining({ type: "del", oldLine: 3, text: "old" }),
                expect.objectContaining({ type: "add", newLine: 3, text: "new" }),
            ])
        );
    });

    it("prefers local branch checkout targets and marks raw hashes as detached", () => {
        expect(checkoutTargetForCommit(commit({ refs: ["HEAD -> main", "origin/main"] }))).toEqual({
            target: "main",
            detached: false,
        });
        expect(
            checkoutTargetForCommit(commit({ refs: ["HEAD -> feat/git-polish", "origin/feat/git-polish"] }))
        ).toEqual({
            target: "feat/git-polish",
            detached: false,
        });
        expect(checkoutTargetForCommit(commit({ refs: ["origin/feature", "tag: v1"] }))).toEqual({
            target: "abc123456789",
            detached: true,
        });
    });

    it("keeps graph render dimensions stable for empty and multi-parent histories", () => {
        expect(makeGraphRenderModel([])).toMatchObject({ width: 188, height: 0, points: [], paths: [] });

        const model = makeGraphRenderModel([
            commit({ hash: "m", parents: ["a", "b"] }),
            commit({ hash: "a", parents: [] }),
            commit({ hash: "b", parents: [] }),
        ]);

        expect(model.height).toBe(126);
        expect(model.points).toHaveLength(3);
        expect(model.width).toBeGreaterThanOrEqual(188);
        expect(model.paths.length).toBeGreaterThan(0);
    });
});
