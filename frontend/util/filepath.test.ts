// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { expandHomePath } from "./filepath";

describe("expandHomePath", () => {
    it.each([
        ["~", "C:\\Users\\中文", true, "C:\\Users\\中文"],
        ["~/Documents/note~1.txt", "C:\\Users\\中文", true, "C:\\Users\\中文/Documents/note~1.txt"],
        ["~\\Documents\\note~1.txt", "C:\\Users\\中文", true, "C:\\Users\\中文\\Documents\\note~1.txt"],
        ["~/file", "C:\\", true, "C:/file"],
        ["C:\\PROGRA~1\\file.txt", "C:\\Users\\me", true, "C:\\PROGRA~1\\file.txt"],
        ["C:\\fixtures\\report~1.txt", "C:\\Users\\me", true, "C:\\fixtures\\report~1.txt"],
        ["~other\\file", "C:\\Users\\me", true, "~other\\file"],
        ["~", "/Users/me", false, "/Users/me"],
        ["~/file~1", "/Users/me/", false, "/Users/me/file~1"],
        ["~/file", "/", false, "/file"],
        ["~\\file", "/Users/me", false, "~\\file"],
        ["/tmp/report~1.txt", "/Users/me", false, "/tmp/report~1.txt"],
        ["~other/file", "/Users/me", false, "~other/file"],
    ])("expands only a home prefix in %s", (path, home, windows, expected) => {
        expect(expandHomePath(path, home, windows)).toBe(expected);
    });
});
