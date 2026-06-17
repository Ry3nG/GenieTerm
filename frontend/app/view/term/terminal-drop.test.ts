import { describe, expect, it } from "vitest";

import { formatDraggedFileTerminalPaste, getDraggedFileTerminalPath } from "./terminal-drop";

describe("terminal-drop", () => {
    it("formats a dragged Files widget path as shell-quoted terminal paste text", () => {
        const draggedFile: DraggedFile = {
            relName: "release notes.txt",
            absParent: "~/workspace",
            path: "~/workspace/release notes.txt",
            uri: "wsh://devbox/~/workspace/release%20notes.txt",
            isDir: false,
        };

        expect(getDraggedFileTerminalPath(draggedFile)).toBe("~/workspace/release notes.txt");
        expect(formatDraggedFileTerminalPaste(draggedFile)).toBe("'~/workspace/release notes.txt' ");
    });

    it("falls back to decoded wsh uri path when explicit path metadata is unavailable", () => {
        const draggedFile: DraggedFile = {
            relName: "build output",
            absParent: "~/workspace",
            uri: "wsh://devbox/%7E/workspace/build%20output",
            isDir: true,
        };

        expect(getDraggedFileTerminalPath(draggedFile)).toBe("~/workspace/build output");
        expect(formatDraggedFileTerminalPaste(draggedFile)).toBe("'~/workspace/build output' ");
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
