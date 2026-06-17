// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { formatDraggedFileTerminalPaste, getDraggedFileTerminalPath } from "./terminal-drop";

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

    it("falls back to decoded wsh uri path when explicit path metadata is unavailable", () => {
        const draggedFile: DraggedFile = {
            relName: "build output",
            absParent: "~/workspace",
            uri: "wsh://devbox/%7E/workspace/build%20output",
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
});
