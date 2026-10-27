// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getTransferSelection, selectDirectoryEntry } from "./directory-selection";

const Entries = ["..", "a", "b", "c", "d"].map((name) => ({ name, path: `/files/${name}` }) as FileInfo);
describe("directory selection", () => {
    it("uses visual order for reverse shift ranges and never selects the parent row", () => {
        const selection = selectDirectoryEntry({ files: [Entries[3]], anchor: Entries[3].path }, Entries[1], Entries, {
            shiftKey: true,
        });
        expect(selection.files.map((file) => file.name)).toEqual(["a", "b", "c"]);
        expect(selection.anchor).toBe(Entries[3].path);
    });
    it("toggles native control/meta selections and adds shift ranges", () => {
        let selection = selectDirectoryEntry({ files: [Entries[1]], anchor: Entries[1].path }, Entries[3], Entries, {
            metaKey: true,
        });
        selection = selectDirectoryEntry(selection, Entries[4], Entries, { ctrlKey: true, shiftKey: true });
        expect(selection.files.map((file) => file.name)).toEqual(["a", "c", "d"]);
        expect(
            selectDirectoryEntry(selection, Entries[1], Entries, { ctrlKey: true }).files.map((file) => file.name)
        ).toEqual(["c", "d"]);
        expect(selectDirectoryEntry(selection, Entries[0], Entries, {}).files).toEqual([]);
    });
    it("avoids copying selected folder descendants twice without treating similar names as descendants", () => {
        const files = [
            { name: "logs", path: "/logs", isdir: true },
            { name: "a", path: "/logs/a" },
            { name: "logs-old", path: "/logs-old" },
        ] as FileInfo[];
        expect(getTransferSelection([...files, files[0]])).toEqual([files[0], files[2]]);
    });
});
