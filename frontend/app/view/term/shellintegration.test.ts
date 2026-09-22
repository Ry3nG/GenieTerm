// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getShellIntegrationRecovery } from "./shellintegration";

const connected = { connection: "zrgong@paw-5090-ws", status: "connected", wshenabled: false } as ConnStatus;

describe("shell integration recovery", () => {
    it("offers enablement when the remote helper is disabled", () => {
        const recovery = getShellIntegrationRecovery({ ...connected, nowshreason: "conn:wshenabled set to false" });
        expect(recovery.action).toBe("enable");
        expect(recovery.message).toContain("disabled");
    });

    it("waits for background installation without offering a conflicting retry", () => {
        expect(
            getShellIntegrationRecovery({ ...connected, nowshreason: "installing wsh in background" }).action
        ).toBeNull();
    });

    it("shows the actual helper failure and offers reconnection", () => {
        const recovery = getShellIntegrationRecovery({ ...connected, wsherror: "SSH forwarding denied" });
        expect(recovery.action).toBe("reconnect");
        expect(recovery.message).toContain("SSH forwarding denied");
    });

    it("does not warn while SSH is connecting or disconnected", () => {
        for (const status of ["connecting", "disconnected", "error"]) {
            expect(getShellIntegrationRecovery({ ...connected, status })).toBeNull();
        }
    });

    it("offers a shell restart after the helper becomes available", () => {
        expect(getShellIntegrationRecovery({ ...connected, wshenabled: true }).action).toBe("restart");
    });

    it("never offers SSH reconnection for local terminals", () => {
        for (const connection of ["", "local", "local:workstation"]) {
            expect(getShellIntegrationRecovery({ ...connected, connection }).action).toBe("restart");
        }
    });
});
