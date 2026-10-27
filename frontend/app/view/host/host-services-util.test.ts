// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { makeSavedService, serviceForward, servicePortNote } from "./host-services-util";

describe("saved port services", () => {
    it("preserves explicit restore consent and uses automatic local ports when blank", () => {
        const service = makeSavedService("api", " API ", "", "3000", "", false);
        expect(service).toEqual({
            id: "api",
            name: "API",
            remotehost: "127.0.0.1",
            remoteport: 3000,
            localport: 0,
            restore: false,
        });
        expect(JSON.parse(JSON.stringify(service))).toEqual(service);
    });

    it.each([
        ["0", ""],
        ["65536", ""],
        ["3000", "-1"],
        ["3000", "3000x"],
    ])("rejects invalid port pair %s / %s", (remote, local) => {
        expect(() => makeSavedService("api", "API", "127.0.0.1", remote, local, false)).toThrow("Ports must");
    });

    it("keeps services with the same port on different remote addresses distinct", () => {
        const service = makeSavedService("api", "API", "10.0.0.2", "3000", "", true);
        const other = { id: "other", remotehost: "127.0.0.1", remoteport: 3000, localport: 3000 } as PortForwardInfo;
        const own = { ...other, id: "own", remotehost: "10.0.0.2", localport: 4321 };
        expect(serviceForward(service, [other, own])).toBe(own);
        expect(servicePortNote(service, own)).toContain("4321");
        expect(servicePortNote(service, { ...own, id: "saved:error" })).toBe("");
    });
});
