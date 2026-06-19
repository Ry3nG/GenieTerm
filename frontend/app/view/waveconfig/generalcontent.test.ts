// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    makeAppIconOptions,
    makeAppThemeOptions,
    updateSettingsJsonAppIcon,
    updateSettingsJsonTheme,
} from "./generalcontent";

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

    it("defaults unknown app icon values to the default option", () => {
        const options = makeAppIconOptions("blue");

        expect(options.find((option) => option.selected)?.icon).toBe("default");
    });

    it("keeps the raw settings JSON in sync after changing app icon visually", () => {
        const nextContent = updateSettingsJsonAppIcon('{"app:theme":"dark"}', "white");

        expect(JSON.parse(nextContent)).toEqual({
            "app:theme": "dark",
            "app:icon": "white",
        });
    });
});
