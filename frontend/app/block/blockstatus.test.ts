// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatElapsedTime, getBlockStatus, type BlockStatusInput } from "./blockstatus";

const Now = 100000;
const Connected = { connection: "root@host", status: "connected", wshenabled: true } as ConnStatus;
const Base: BlockStatusInput = {
    connStatus: Connected,
    isTerminal: true,
    now: Now,
    missingIntegrationSince: Now - 2500,
    durableEligible: true,
};

function select(conn: Partial<ConnStatus>, input: Partial<BlockStatusInput> = {}) {
    return getBlockStatus({ ...Base, ...input, connStatus: { ...Connected, ...conn } });
}

describe("block status priority", () => {
    it("puts errors above reconnect, shell recovery and durable prompts", () => {
        const error = "Permission denied.\n" + "Details ".repeat(30);
        const status = select({ status: "error", error, reconnecting: true, nextreconnectts: Now + 4000 });
        expect(status.kind).toBe("error");
        expect(status.title).toBe("Couldn't connect to root@host");
        expect(status.detail.length).toBeLessThanOrEqual(120);
        expect(status.tooltip).toBe(error);
        expect(status.actions.map((action) => action.id)).toEqual(["reconnect", "copy"]);
    });

    it("counts down reconnect attempts and clamps expired deadlines", () => {
        const conn = { status: "disconnected", reconnecting: true, nextreconnectts: Now + 3500, reconnectattempt: 2 };
        expect(select(conn).detail).toBe("Reconnecting in 4s (attempt 2)");
        expect(select(conn, { now: Now + 4000 }).detail).toBe("Reconnecting in 0s (attempt 2)");
        expect(select(conn).actions.map((action) => action.label)).toEqual(["Reconnect now", "Cancel"]);
    });

    it.each(["connecting", "disconnected"])("handles %s before terminal states", (status) => {
        expect(select({ status }).kind).toBe(status);
    });

    it("treats reconnecting without a deadline as an active connection attempt", () => {
        expect(select({ status: "disconnected", reconnecting: true }).kind).toBe("connecting");
    });

    it("puts a stalled connection above helper failure and offers a fresh connection", () => {
        const status = select({
            connhealthstatus: "stalled",
            lastactivitybeforestalledtime: Now - 50000,
            wsherror: "broken",
        });
        expect(status.kind).toBe("stalled");
        expect(status.detail).toBe("No reply for 50s — it may recover on its own");
        expect(status.actions.map((action) => action.id)).toEqual(["reconnect-stalled", "disconnect"]);
    });

    it("ignores degraded health", () => {
        expect(select({ connhealthstatus: "degraded" }, { isTerminal: false })).toBeNull();
    });

    it("offers in-place helper repair before installation or terminal recovery", () => {
        const status = select({
            wshenabled: false,
            wsherror: "forwarding denied",
            nowshreason: "installing wsh in background",
        });
        expect(status.kind).toBe("helper-failed");
        expect(status.actions.map((action) => action.id)).toEqual(["retry-helper", "disable-helper", "copy"]);
        expect(status.dismiss).toBe("dismiss-helper-error");
        expect(select({ wsherror: "old failure" }, { wshConfigEnabled: false, isTerminal: false })).toBeNull();
    });

    it("shows installation immediately, including on non-terminal blocks", () => {
        const status = select(
            { wshenabled: false, nowshreason: "installing wsh in background" },
            { isTerminal: false, missingIntegrationSince: Now }
        );
        expect(status.kind).toBe("helper-installing");
        expect(status.actions).toEqual([]);
        expect(status.detail).not.toContain("%");
        const progress = select(
            { wshenabled: false, nowshreason: "installing wsh in background", wshinstallpct: 42 },
            { isTerminal: false }
        );
        expect(progress.detail).toMatch(/^42% copied · /);
    });

    it.each(["isLayoutMode", "connModalOpen"] as const)("preserves %s suppression and health exceptions", (flag) => {
        expect(select({ status: "connecting" }, { [flag]: true })).toBeNull();
        expect(select({ connhealthstatus: "stalled" }, { [flag]: true }).kind).toBe("stalled");
        expect(select({ wsherror: "failed" }, { [flag]: true }).kind).toBe("helper-failed");
    });

    it("waits 2.5 seconds before missing shell integration warnings", () => {
        expect(select({}, { now: Now - 1 }).kind).toBe("durable-prompt");
        expect(select({}).actions[0].id).toBe("restart");
        expect(select({}, { integrationReported: true }).kind).toBe("durable-prompt");
        expect(select({}, { missingIntegrationSince: undefined, durableEligible: false })).toBeNull();
    });

    it("makes helper-off informational and dismissible for the session", () => {
        const conn = { wshenabled: false, nowshreason: "conn:wshenabled set to false" };
        expect(select(conn)).toMatchObject({ kind: "helper-off", severity: "info", dismiss: "dismiss-helper-off" });
        expect(select(conn).actions[0].id).toBe("enable");
        expect(select(conn, { helperOffDismissed: true }).kind).toBe("durable-prompt");
    });

    it("explains PowerShell without suggesting a restart", () => {
        const status = select({}, { report: { integrationDisabled: true, shellType: "pwsh" } });
        expect(status.severity).toBe("info");
        expect(status.actions).toEqual([]);
        expect(status.title).toContain("PowerShell");
    });

    it("shows no terminal-only states on other views", () => {
        expect(select({}, { isTerminal: false })).toBeNull();
    });

    it("offers durable sessions only when eligible, after integration recovery", () => {
        expect(select({}, { integrationReported: true })).toMatchObject({ kind: "durable-prompt", dismiss: "not-now" });
        expect(select({}, { integrationReported: true, durableEligible: false })).toBeNull();
    });

    it("does not invent a disconnected connection when no connection is configured", () => {
        expect(getBlockStatus({ isTerminal: false, now: Now })).toBeNull();
    });

    it.each([
        [50000, "50s"],
        [60000, "1m"],
        [3600000, "1h"],
        [3660000, "1h1m"],
        [86400000, "more than a day"],
        [-1, ""],
    ])("formats elapsed %s", (ms, expected) => {
        expect(formatElapsedTime(Number(ms))).toBe(expected);
    });
});
