// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { makeGitChip } from "./gitchip";

function status(partial: Partial<GitStatusResponse>): GitStatusResponse {
    return { branch: "main", files: [], exitcode: 0, supported: true, ...partial };
}

describe("makeGitChip", () => {
    it("is empty outside a repository", () => {
        expect(makeGitChip(null)).toBeNull();
        expect(makeGitChip(status({ exitcode: 128 }))).toBeNull();
        expect(makeGitChip(status({ branch: "" }))).toBeNull();
    });

    it("shows a clean branch tracking its upstream", () => {
        expect(makeGitChip(status({ upstream: "origin/main" }))).toEqual({
            label: "main",
            title: "Branch main · up to date with origin/main · no changes",
            dirty: false,
        });
    });

    it("shows ahead, behind and changes", () => {
        const chip = makeGitChip(
            status({
                branch: "feat/x",
                upstream: "origin/feat/x",
                ahead: 2,
                behind: 1,
                files: [{ path: "a", index: "M", worktree: " " }],
            })
        );
        expect(chip.label).toBe("feat/x ↑2 ↓1");
        expect(chip.title).toBe("Branch feat/x · 2 ahead, 1 behind origin/feat/x · 1 changed file");
        expect(chip.dirty).toBe(true);
    });

    it("names a detached HEAD", () => {
        expect(makeGitChip(status({ branch: "", detached: true }))?.label).toBe("detached HEAD");
    });
});
