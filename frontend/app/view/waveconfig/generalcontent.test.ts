// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    makeAppIconOptions,
    makeAppThemeOptions,
    updateSettingsJsonAppIcon,
    updateSettingsJsonTheme,
    updateSettingsJsonValue,
} from "./generalcontent";

describe("general settings content", () => {
    it.each(["Hack", true, false, 14.5, 0, null, ["a", 2], { nested: true }])(
        "writes JSON value %j without losing other settings",
        (value) => {
            expect(JSON.parse(updateSettingsJsonValue('{"keep":false,"value":"old"}', "value", value))).toEqual({
                keep: false,
                value,
            });
        }
    );

    it("initializes an empty settings file", () => {
        expect(JSON.parse(updateSettingsJsonValue("  ", "term:fontsize", 12))).toEqual({ "term:fontsize": 12 });
    });

    it.each(["{bad", "[]", "null", "true", "12", '"text"'])("preserves invalid settings objects: %s", (content) => {
        expect(updateSettingsJsonValue(content, "term:cursorblink", true)).toBe(content);
    });

    it("defaults unknown theme values to the dark option", () => {
        const options = makeAppThemeOptions("system");

        expect(options.find((option) => option.selected)?.theme).toBe("dark");
    });

    it("always resolves to the dark option (light removed)", () => {
        const options = makeAppThemeOptions("light");

        expect(options.find((option) => option.selected)?.theme).toBe("dark");
        expect(options.some((option) => option.theme === "light")).toBe(false);
    });

    it("keeps the raw settings JSON in sync after changing theme visually", () => {
        const nextContent = updateSettingsJsonTheme('{"app:tabbar":"top"}', "dark");

        expect(JSON.parse(nextContent)).toEqual({
            "app:tabbar": "top",
            "app:theme": "dark",
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
