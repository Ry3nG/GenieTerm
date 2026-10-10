// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { CmdBlock } from "./cmdblocks";
import {
    formatCommandNotification,
    formatCommandNotificationDuration,
    shouldNotifyCommandDone,
    type CommandNotificationDecision,
} from "./cmdnotify";

function makeBlock(overrides: Partial<CmdBlock> = {}): CmdBlock {
    return {
        id: 1,
        startMarker: null,
        endMarker: null,
        command: "make test",
        state: "done",
        exitCode: 0,
        startTs: 1000,
        doneTs: 11000,
        cwd: "/Users/me/project",
        ...overrides,
    };
}

function makeDecision(overrides: Partial<CommandNotificationDecision> = {}): CommandNotificationDecision {
    return {
        block: makeBlock(),
        thresholdSeconds: 10,
        windowFocused: false,
        tabActive: true,
        blockFocused: true,
        nowMs: 10000,
        ...overrides,
    };
}

describe("command notification decision", () => {
    it.each([
        ["disabled", { thresholdSeconds: 0 }, false],
        ["negative threshold", { thresholdSeconds: -1 }, false],
        ["NaN threshold", { thresholdSeconds: NaN }, false],
        ["infinite threshold", { thresholdSeconds: Infinity }, false],
        ["absent block", { block: null }, false],
        ["absent command", { block: makeBlock({ command: null }) }, false],
        ["empty command", { block: makeBlock({ command: " \n\t " }) }, false],
        ["placeholder", { block: makeBlock({ command: "# command too large (9999 bytes)" }) }, false],
        ["still running", { block: makeBlock({ state: "running" }) }, false],
        ["no start", { block: makeBlock({ startTs: 0 }) }, false],
        ["no finish", { block: makeBlock({ doneTs: null }) }, false],
        ["interrupted", { block: makeBlock({ interrupted: true }) }, false],
        ["Ctrl-C", { block: makeBlock({ exitCode: 130 }) }, false],
        ["short command", { block: makeBlock({ doneTs: 10999 }) }, false],
        ["invalid duration", { block: makeBlock({ doneTs: NaN }) }, false],
        ["clock went backwards", { block: makeBlock({ doneTs: 500 }) }, false],
        ["exact threshold", {}, true],
        ["fractional threshold", { thresholdSeconds: 10.001 }, false],
        ["longer than threshold", { block: makeBlock({ doneTs: 12000 }) }, true],
        ["failed command", { block: makeBlock({ exitCode: 1 }) }, true],
        ["unknown result", { block: makeBlock({ exitCode: null }) }, true],
        ["watched", { windowFocused: true }, false],
        ["inactive tab", { windowFocused: true, tabActive: false }, true],
        ["unfocused block", { windowFocused: true, blockFocused: false }, true],
        ["coalesced", { lastNotificationMs: 7001 }, false],
        ["exact coalescing boundary", { lastNotificationMs: 7000 }, true],
        ["coalescing expired", { lastNotificationMs: 6999 }, true],
        ["timestamp zero is real", { nowMs: 2999, lastNotificationMs: 0 }, false],
    ] satisfies [string, Partial<CommandNotificationDecision>, boolean][])("%s", (_name, overrides, expected) => {
        expect(shouldNotifyCommandDone(makeDecision(overrides))).toBe(expected);
    });

    it.each([true, false])("all visibility combinations with windowFocused=%s", (windowFocused) => {
        for (const tabActive of [true, false]) {
            for (const blockFocused of [true, false]) {
                expect(shouldNotifyCommandDone(makeDecision({ windowFocused, tabActive, blockFocused }))).toBe(
                    !(windowFocused && tabActive && blockFocused)
                );
            }
        }
    });
});

describe("command notification content", () => {
    it.each([
        [0, "0s"],
        [-1, "0s"],
        [45999, "45s"],
        [59999, "59s"],
        [60000, "1m 0s"],
        [252000, "4m 12s"],
        [3599999, "59m 59s"],
        [3600000, "1h 00m"],
        [7500000, "2h 05m"],
    ])("formats %i ms as %s", (durationMs, expected) => {
        expect(formatCommandNotificationDuration(durationMs)).toBe(expected);
    });

    it.each([
        [0, "Finished in 4m 12s"],
        [1, "Failed with exit code 1 after 4m 12s"],
        [137, "Failed with exit code 137 after 4m 12s"],
        [null, "Finished after 4m 12s"],
    ])("formats exit code %s", (exitCode, body) => {
        expect(formatCommandNotification(makeBlock({ exitCode, doneTs: 253000, cwd: null }))).toEqual({
            title: "make test",
            body,
            silent: false,
        });
    });

    it.each([null, "", "local", "local:host", "conn:local"])("labels local connection %s", (connection) => {
        expect(formatCommandNotification(makeBlock(), connection, "/Users/me").body).toBe(
            "Finished in 10s · ~/project"
        );
    });

    it.each(["me@gpu-01", "wsl://Ubuntu"])("labels remote connection %s", (connection) => {
        expect(formatCommandNotification(makeBlock(), connection, "/Users/me").body).toBe(
            `Finished in 10s · ${connection}`
        );
    });

    it.each([
        ["/Users/me/project", null, "/Users/me/project"],
        ["/a/b/c/d/e", null, "…/c/d/e"],
        ["/Users/me", "/Users/me", "~"],
    ])("formats local path %s", (cwd, home, label) => {
        expect(formatCommandNotification(makeBlock({ cwd }), "local", home).body).toBe(`Finished in 10s · ${label}`);
    });

    it.each([
        ["  make\n  test\t --all  ", "make test --all"],
        ["a".repeat(60), "a".repeat(60)],
        ["a".repeat(61), "a".repeat(59) + "…"],
        ["😀".repeat(61), "😀".repeat(59) + "…"],
    ])("collapses and truncates titles", (command, title) => {
        expect(formatCommandNotification(makeBlock({ command })).title).toBe(title);
    });
});
