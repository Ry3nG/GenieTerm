// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    getPreviewFileName,
    getPreviewRenamePath,
    isLocalWindowsFilePath,
    quotePreviewFilePath,
} from "./preview-file-path";

describe("Files paths", () => {
    it.each([
        ["C:\\Audit\\中文 files\\note.txt", "", "note.txt", "C:\\Audit\\中文 files\\renamed.txt"],
        ["C:/Audit/中文 files/note.txt", "local", "note.txt", "C:/Audit/中文 files/renamed.txt"],
        [
            "\\\\server\\share\\中文 files\\note.txt",
            "local:powershell",
            "note.txt",
            "\\\\server\\share\\中文 files\\renamed.txt",
        ],
        ["D:\\note.txt", "", "note.txt", "D:\\renamed.txt"],
        ["/home/me/a\\b.txt", "devbox", "a\\b.txt", "/home/me/renamed.txt"],
        ["~/notes/note.txt", "wsl://Ubuntu", "note.txt", "~/notes/renamed.txt"],
        ["C:\\name.txt", "devbox", "C:\\name.txt", "renamed.txt"],
    ])("renames %s within its original directory (%s)", (path, connection, name, expected) => {
        expect(getPreviewFileName(path, connection)).toBe(name);
        expect(getPreviewRenamePath(path, "renamed.txt", connection)).toBe(expected);
    });

    it("quotes local Windows names literally for PowerShell", () => {
        const path = "C:\\中文 files\\O'Brien $HOME.txt";
        expect(isLocalWindowsFilePath(path, "local")).toBe(true);
        expect(quotePreviewFilePath(path, path, "local")).toBe("'C:\\中文 files\\O''Brien $HOME.txt'");
        expect(quotePreviewFilePath("O'Brien $HOME.txt", path, "")).toBe("'O''Brien $HOME.txt'");
    });

    it("preserves POSIX quoting on remote connections and WSL", () => {
        for (const connection of ["devbox", "wsl://Ubuntu"]) {
            expect(isLocalWindowsFilePath("C:\\name.txt", connection)).toBe(false);
            expect(quotePreviewFilePath("a $HOME.txt", "/home/me/a $HOME.txt", connection)).toBe("'a $HOME.txt'");
        }
    });
});
