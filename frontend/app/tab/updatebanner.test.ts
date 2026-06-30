// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getUpdateStatusMessage, getUpdateStatusTooltip, isUpdateStatusActionable } from "./updatebanner";

describe("update banner status", () => {
    it("keeps background download states informational", () => {
        expect(getUpdateStatusMessage("available")).toBe("Downloading Update");
        expect(getUpdateStatusMessage("downloading")).toBe("Downloading Update");
        expect(isUpdateStatusActionable("available")).toBe(false);
        expect(isUpdateStatusActionable("downloading")).toBe(false);
        expect(getUpdateStatusTooltip("downloading", "Downloading Update")).toBe(
            "Downloading update in the background"
        );
    });

    it("only makes ready updates actionable", () => {
        expect(getUpdateStatusMessage("ready")).toBe("Install Update");
        expect(isUpdateStatusActionable("ready")).toBe(true);
        expect(getUpdateStatusTooltip("ready", "Install Update")).toBe("Restart GenieTerm to install update");
    });
});
