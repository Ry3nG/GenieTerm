// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { makeWidgetSettingsActionItems } from "./widgets";

describe("widget settings actions", () => {
    it("keeps the bottom actions focused on Settings", () => {
        const onOpenSettings = vi.fn();
        const items = makeWidgetSettingsActionItems({
            hasConfigErrors: true,
            onOpenSettings,
        });

        expect(items.map((item) => item.label)).toEqual(["Settings"]);
        expect(items.map((item) => item.label)).not.toContain("Tips");
        expect(items.map((item) => item.label)).not.toContain("Secrets");
        expect(items.map((item) => item.label)).not.toContain("Release Notes");
        expect(items.map((item) => item.label)).not.toContain("Help");

        expect(items[0].icon).toBe("gear");
        expect(items[0].hasError).toBe(true);

        items[0].onClick();
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });
});
