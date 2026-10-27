// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { makeHostSessions } from "./host-sessions-util";

function job(oid: string, overrides: Partial<Job> = {}): Job {
    return {
        oid,
        connection: "dev",
        jobkind: "shell",
        cmd: "/bin/bash",
        jobmanagerstatus: "running",
        ...overrides,
    } as Job;
}

describe("durable host inventory", () => {
    it("never calls an unreachable running job connected and excludes other hosts", () => {
        const sessions = makeHostSessions(
            [job("alive"), job("unknown"), job("other", { connection: "production" })],
            "dev",
            ["alive"]
        );
        expect(sessions.map((session) => [session.id, session.status])).toEqual([
            ["alive", "connected"],
            ["unknown", "disconnected"],
        ]);
        expect(sessions[1].detail).toContain("unverified");
    });

    it("prioritizes live sessions, preserves exit status, and never exposes job credentials", () => {
        const sessions = makeHostSessions(
            [
                job("done", {
                    cmdexitts: 200,
                    cmdexitcode: 2,
                    jobauthtoken: "secret",
                    cmdenv: { TOKEN: "secret" },
                    cmdstartts: 100,
                }),
                job("active", { cmdstartts: 50, attachedblockid: "terminal" }),
            ],
            "dev",
            ["active", "done"]
        );
        expect(sessions[0].id).toBe("active");
        expect(sessions[0].blockid).toBe("terminal");
        expect(sessions[1].status).toBe("finished");
        expect(sessions[1].detail).toBe("Exit code 2");
        expect(JSON.stringify(sessions)).not.toContain("secret");
    });
});
