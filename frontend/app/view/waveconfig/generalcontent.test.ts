// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { makeAppThemeOptions, updateSettingsJsonTheme } from "./generalcontent";

describe("general settings content", () => {
    it("defaults unknown theme values to the dark option", () => {
        const options = makeAppThemeOptions("system");

        expect(options.find((option) => option.selected)?.theme).toBe("dark");
    });

    it("marks the light option selected when configured", () => {
        const options = makeAppThemeOptions("light");

        expect(options.find((option) => option.selected)?.theme).toBe("light");
    });

    it("keeps the raw settings JSON in sync after changing theme visually", () => {
        const nextContent = updateSettingsJsonTheme('{"app:tabbar":"top"}', "light");

        expect(JSON.parse(nextContent)).toEqual({
            "app:tabbar": "top",
            "app:theme": "light",
        });
    });
});
