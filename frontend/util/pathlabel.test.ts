// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { cwdBasename, formatCwdLabel, getTabDisplayName, isDefaultTabName } from "./pathlabel";

describe("formatCwdLabel", () => {
    it("abbreviates the home directory", () => {
        expect(formatCwdLabel("/Users/me", "/Users/me")).toBe("~");
        expect(formatCwdLabel("/Users/me/Code/app", "/Users/me/")).toBe("~/Code/app");
        expect(formatCwdLabel("/Users/meadow/x", "/Users/me")).toBe("/Users/meadow/x");
    });

    it("keeps the last segments of deep paths", () => {
        expect(formatCwdLabel("/Users/me/Code/app/src/view/term", "/Users/me")).toBe("…/src/view/term");
        expect(formatCwdLabel("/var/log/nginx/", undefined)).toBe("/var/log/nginx");
    });

    it("handles empty and root paths", () => {
        expect(formatCwdLabel("", "/Users/me")).toBe("");
        expect(formatCwdLabel("/", "/Users/me")).toBe("/");
    });

    it("abbreviates Windows homes from normalized shell paths and native Electron paths", () => {
        expect(formatCwdLabel("C:/Users/me", "C:\\Users\\me")).toBe("~");
        expect(formatCwdLabel("c:/users/Me/Code/app", "C:\\Users\\me\\")).toBe("~/Code/app");
        expect(formatCwdLabel("C:\\Users\\me\\Code\\app", "C:\\Users\\me")).toBe("~/Code/app");
        expect(formatCwdLabel("C:/Users/meadow", "C:\\Users\\me")).toBe("C:/Users/meadow");
        expect(formatCwdLabel("\\\\server\\share\\me\\Code", "\\\\server\\share\\me")).toBe("~/Code");
        expect(formatCwdLabel("C:/")).toBe("C:/");
    });

    it("preserves case and backslashes in POSIX directory names", () => {
        expect(formatCwdLabel("/home/Me/Code", "/home/me")).toBe("/home/Me/Code");
        expect(formatCwdLabel("/home/a\\b", "/home/me")).toBe("/home/a\\b");
    });
});

describe("cwdBasename", () => {
    it("labels home, root and folders", () => {
        expect(cwdBasename("/Users/me", "/Users/me")).toBe("~");
        expect(cwdBasename("~")).toBe("~");
        expect(cwdBasename("/")).toBe("/");
        expect(cwdBasename("/Users/me/Code/GenieTerm/", "/Users/me")).toBe("GenieTerm");
        expect(cwdBasename("")).toBe("");
    });

    it("labels Windows folders and drive roots without exposing the full native path", () => {
        expect(cwdBasename("c:/users/ME", "C:\\Users\\me")).toBe("~");
        expect(cwdBasename("C:\\Users\\me\\Documents\\")).toBe("Documents");
        expect(cwdBasename("\\\\server\\share\\Documents")).toBe("Documents");
        expect(cwdBasename("C:\\")).toBe("C:/");
        expect(cwdBasename("D:/")).toBe("D:/");
    });
});

describe("getTabDisplayName", () => {
    const termMeta = { view: "term", "cmd:cwd": "/Users/me/Code/GenieTerm" } as MetaType;

    it("labels generated tab names with the first terminal's folder", () => {
        expect(isDefaultTabName("T3")).toBe(true);
        expect(getTabDisplayName("T3", termMeta, "/Users/me")).toBe("GenieTerm");
        expect(getTabDisplayName("T1", { view: "term", "cmd:cwd": "/Users/me" } as MetaType, "/Users/me")).toBe("~");
    });

    it("keeps names the user chose and non-terminal tabs", () => {
        expect(isDefaultTabName("deploy")).toBe(false);
        expect(getTabDisplayName("deploy", termMeta, "/Users/me")).toBe("deploy");
        expect(getTabDisplayName("T2", { view: "preview" } as MetaType, "/Users/me")).toBe("T2");
        expect(getTabDisplayName("T2", { view: "term" } as MetaType, "/Users/me")).toBe("T2");
    });
});
