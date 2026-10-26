// Copyright 2026, GenieTerm. Apache-2.0.

import { describe, expect, it } from "vitest";
import { getParentDirectory, goHistoryBack, goHistoryForward } from "./historyutil";

describe("file history navigation", () => {
    it.each([
        ["C:\\Users\\me\\Documents", "C:\\Users\\me"],
        ["C:\\Users\\", "C:\\"],
        ["C:/Users/me", "C:/Users"],
        ["C:/Users", "C:/"],
        ["D:/", "D:/"],
        ["D:\\", "D:\\"],
        ["\\\\server\\share\\folder", "\\\\server\\share\\"],
        ["\\\\server\\share\\folder\\child", "\\\\server\\share\\folder"],
        ["\\\\server\\share", "\\\\server\\share"],
        ["\\\\server\\share\\", "\\\\server\\share\\"],
        ["//server/share/folder", "//server/share/"],
        ["//server/share/", "//server/share/"],
        ["/home/me/folder", "/home/me"],
        ["/home/name\\with\\slashes/file", "/home/name\\with\\slashes"],
        ["/", "/"],
        [null, "/"],
        ["", "/"],
    ])("finds the parent of %s", (path, parent) => {
        expect(getParentDirectory(path)).toBe(parent);
    });

    it("returns to the same Windows folder after going back and forward", () => {
        const current = "C:\\Users\\me\\Documents";
        const back = goHistoryBack("file", current, {}, true);
        expect(back).toEqual({ file: "C:\\Users\\me", "history:forward": [current] });
        expect(goHistoryForward("file", back.file, back)).toEqual({
            file: current,
            history: ["C:\\Users\\me"],
            "history:forward": [],
        });
    });

    it.each(["C:/", "C:\\", "\\\\server\\share\\", "//server/share/"])(
        "does not create a history entry above the root %s",
        (root) => {
            expect(goHistoryBack("file", root, {}, true)).toBeNull();
        }
    );

    it("uses existing navigation history even when the current folder is a drive root", () => {
        expect(goHistoryBack("file", "D:/", { history: ["C:/Users/me"] }, true)).toEqual({
            file: "C:/Users/me",
            history: [],
            "history:forward": ["D:/"],
        });
    });
});
