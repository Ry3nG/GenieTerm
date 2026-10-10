// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { hasRemoteFileChanged, makeSaveBaseline, makeSaveConflictMessage } from "./preview-save";

const loaded: FileInfo = { path: "~/app.py", modtime: 1_700_000_000_000, size: 120 };

describe("save conflict detection", () => {
    it("allows the save when the file is unchanged", () => {
        expect(hasRemoteFileChanged(makeSaveBaseline(loaded), { ...loaded })).toBe(false);
    });

    it("detects a changed mtime or size", () => {
        const baseline = makeSaveBaseline(loaded);
        expect(hasRemoteFileChanged(baseline, { ...loaded, modtime: loaded.modtime + 1000 })).toBe(true);
        expect(hasRemoteFileChanged(baseline, { ...loaded, size: 121 })).toBe(true);
    });

    it("detects a file deleted or created since it was opened", () => {
        expect(hasRemoteFileChanged(makeSaveBaseline(loaded), { path: "~/app.py", notfound: true })).toBe(true);
        const newFile = makeSaveBaseline({ path: "~/new.py", notfound: true });
        expect(hasRemoteFileChanged(newFile, { path: "~/new.py", notfound: true })).toBe(false);
        expect(hasRemoteFileChanged(newFile, { path: "~/new.py", modtime: 5, size: 3 })).toBe(true);
    });

    it("does not block the save without a baseline", () => {
        expect(hasRemoteFileChanged(null, loaded)).toBe(false);
    });

    it("offers overwrite, reload and cancel naming the path", () => {
        const overwrite = vi.fn();
        const reload = vi.fn();
        const msg = makeSaveConflictMessage("~/app.py", loaded, { overwrite, reload });
        expect(msg.text).toContain("~/app.py");
        expect(msg.buttons.map((button) => button.text)).toEqual(["Overwrite", "Reload", "Cancel"]);
        msg.buttons[0].onClick();
        msg.buttons[1].onClick();
        msg.buttons[2].onClick();
        expect(overwrite).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
