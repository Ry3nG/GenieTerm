// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { formatDraggedFileTerminalPaste, getDraggedFileTerminalPath, quoteForTerminalPaste } from "./terminal-drop";

describe("terminal-drop", () => {
    it("formats a dragged Files widget path without disabling home expansion", () => {
        const draggedFile: DraggedFile = {
            relName: "release notes.txt",
            absParent: "~/workspace",
            path: "~/workspace/release notes.txt",
            uri: "wsh://devbox/~/workspace/release%20notes.txt",
            isDir: false,
        };

        expect(getDraggedFileTerminalPath(draggedFile)).toBe("~/workspace/release notes.txt");
        expect(formatDraggedFileTerminalPaste(draggedFile, { terminalConnection: "devbox" })).toBe(
            "~/'workspace/release notes.txt' "
        );
    });

    it("falls back to the wsh uri path when explicit path metadata is unavailable", () => {
        const draggedFile: DraggedFile = {
            relName: "build output",
            absParent: "~/workspace",
            uri: "wsh://devbox/~/workspace/build output",
            isDir: true,
        };

        expect(getDraggedFileTerminalPath(draggedFile)).toBe("~/workspace/build output");
        expect(formatDraggedFileTerminalPaste(draggedFile, { terminalConnection: "devbox" })).toBe(
            "~/'workspace/build output' "
        );
    });

    it("pastes the remote URI when dropped into a different connection", () => {
        const draggedFile: DraggedFile = {
            relName: "nested.txt",
            absParent: "~/genieterm-smoke/remote-folder",
            path: "~/genieterm-smoke/remote-folder/nested.txt",
            uri: "wsh://devbox/~/genieterm-smoke/remote-folder/nested.txt",
            isDir: false,
        };

        expect(getDraggedFileTerminalPath(draggedFile, { terminalConnection: "local" })).toBe(
            "wsh://devbox/~/genieterm-smoke/remote-folder/nested.txt"
        );
        expect(formatDraggedFileTerminalPaste(draggedFile, { terminalConnection: "local" })).toBe(
            "'wsh://devbox/~/genieterm-smoke/remote-folder/nested.txt' "
        );
    });

    it("treats a running manual ssh command as the same remote connection", () => {
        const draggedFile: DraggedFile = {
            relName: "nested.txt",
            absParent: "~/genieterm-smoke/remote-folder",
            path: "~/genieterm-smoke/remote-folder/nested.txt",
            uri: "wsh://zrgong@paw-5090-ws/~/genieterm-smoke/remote-folder/nested.txt",
            isDir: false,
        };

        expect(
            formatDraggedFileTerminalPaste(draggedFile, {
                terminalConnection: "local",
                terminalShellIntegrationStatus: "running-command",
                terminalLastCommand: "ssh zrgong@paw-5090-ws",
            })
        ).toBe("~/genieterm-smoke/remote-folder/nested.txt ");
    });

    it("pastes the remote URI after a manual ssh command has returned to the local shell", () => {
        const draggedFile: DraggedFile = {
            relName: "nested.txt",
            absParent: "~/genieterm-smoke/remote-folder",
            path: "~/genieterm-smoke/remote-folder/nested.txt",
            uri: "wsh://zrgong@paw-5090-ws/~/genieterm-smoke/remote-folder/nested.txt",
            isDir: false,
        };

        expect(
            formatDraggedFileTerminalPaste(draggedFile, {
                terminalConnection: "local",
                terminalShellIntegrationStatus: "ready",
                terminalLastCommand: "ssh zrgong@paw-5090-ws",
            })
        ).toBe("'wsh://zrgong@paw-5090-ws/~/genieterm-smoke/remote-folder/nested.txt' ");
    });

    it("escapes single quotes in dragged paths", () => {
        const draggedFile: DraggedFile = {
            relName: "today's log.txt",
            absParent: "/tmp",
            path: "/tmp/today's log.txt",
            uri: "wsh://devbox//tmp/today's%20log.txt",
            isDir: false,
        };

        expect(formatDraggedFileTerminalPaste(draggedFile)).toBe("'/tmp/today'\\''s log.txt' ");
    });

    it("quotes Windows file paths using the target PowerShell syntax", () => {
        const path = "C:\\Users\\me\\today's log.txt";
        expect(quoteForTerminalPaste(path, { terminalShellType: "pwsh" })).toBe("'C:\\Users\\me\\today''s log.txt'");
        expect(formatDraggedFileTerminalPaste({ path } as DraggedFile, { terminalShellType: "pwsh" })).toBe(
            "'C:\\Users\\me\\today''s log.txt' "
        );
        expect(quoteForTerminalPaste("~/My Docs/today's log.txt", { terminalShellType: "pwsh" })).toBe(
            "($HOME + '/My Docs/today''s log.txt')"
        );
    });

    it("uses remote shell quoting while a manual SSH session runs inside PowerShell", () => {
        expect(
            quoteForTerminalPaste("/tmp/today's log.txt", {
                terminalShellType: "pwsh",
                terminalShellIntegrationStatus: "running-command",
                terminalLastCommand: "ssh -p 2222 me@server",
            })
        ).toBe("'/tmp/today'\\''s log.txt'");
    });

    it.skipIf(process.platform !== "win32")(
        "preserves dropped paths when parsed by Windows PowerShell",
        () => {
            const paths = [
                "C:\\Users\\me\\today's log.txt",
                "C:\\Logs\\$variable `tick (parens) & text.txt",
                "\\\\server\\share\\中文 file.txt",
                "~/My Docs/today's log.txt",
            ];
            const expressions = paths.map((path) => quoteForTerminalPaste(path, { terminalShellType: "pwsh" }));
            const script = [
                "$ErrorActionPreference = 'Stop'",
                "$ProgressPreference = 'SilentlyContinue'",
                "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
                `@(${expressions.join("; ")}) | ConvertTo-Json -Compress`,
            ].join("\n");
            const output = execFileSync(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
                {
                    encoding: "utf8",
                    windowsHide: true,
                    timeout: 15000,
                }
            );
            const values = JSON.parse(output.replace(/^\uFEFF/, ""));
            expect(values.slice(0, 3)).toEqual(paths.slice(0, 3));
            expect(values[3]).toBe(process.env.USERPROFILE + "/My Docs/today's log.txt");
        },
        20000
    );
});
