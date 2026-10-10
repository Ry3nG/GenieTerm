// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { makeWidgetBlockDef } from "./widgetblockdef";

const filesDef: BlockDef = { meta: { view: "preview", file: "~" } };
const hostDef: BlockDef = { meta: { view: "host" } };
const termDef: BlockDef = { meta: { view: "term", controller: "shell" } };

describe("makeWidgetBlockDef", () => {
    it("opens Host on the focused remote connection", () => {
        expect(makeWidgetBlockDef(hostDef, { connection: "me@gpu-01" }).meta).toEqual({
            view: "host",
            connection: "me@gpu-01",
        });
    });

    it("opens Files in the focused terminal's directory on its connection", () => {
        expect(makeWidgetBlockDef(filesDef, { connection: "me@gpu-01", "cmd:cwd": "/srv/app" }).meta).toEqual({
            view: "preview",
            file: "/srv/app",
            connection: "me@gpu-01",
        });
    });

    it("uses the local directory without adding a connection", () => {
        expect(makeWidgetBlockDef(filesDef, { "cmd:cwd": "/Users/me/code" }).meta).toEqual({
            view: "preview",
            file: "/Users/me/code",
        });
    });

    it("leaves terminals and explicit connections alone", () => {
        expect(makeWidgetBlockDef(termDef, { connection: "me@gpu-01" })).toBe(termDef);
        const pinned: BlockDef = { meta: { view: "host", connection: "local" } };
        expect(makeWidgetBlockDef(pinned, { connection: "me@gpu-01" })).toBe(pinned);
        expect(makeWidgetBlockDef(hostDef, null)).toBe(hostDef);
        expect(makeWidgetBlockDef(hostDef, { connection: "local" })).toBe(hostDef);
    });
});
