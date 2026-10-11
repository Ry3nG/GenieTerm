// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { usesPackageManagerUpdates } from "./updater-platform";

describe("updater platform", () => {
    it("leaves .deb installs to the package manager and updates AppImages itself", () => {
        expect(usesPackageManagerUpdates("linux", {})).toBe(true);
        expect(usesPackageManagerUpdates("linux", { APPIMAGE: "/home/me/GenieTerm.AppImage" })).toBe(false);
        expect(usesPackageManagerUpdates("darwin", {})).toBe(false);
        expect(usesPackageManagerUpdates("win32", {})).toBe(false);
    });
});
