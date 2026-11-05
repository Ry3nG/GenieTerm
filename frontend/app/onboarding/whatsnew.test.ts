// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { version } from "../../../package.json";
import { CurrentOnboardingVersion, isOlderThan, UpgradeReleases } from "./whatsnew";

describe("What's New release gate", () => {
    it("requires highlights for the exact version being shipped", () => {
        expect(CurrentOnboardingVersion).toBe(`v${version}`);
        const items = UpgradeReleases[0].items;
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
            expect(item.title.trim()).not.toBe("");
            expect(item.description).toEqual(expect.stringMatching(/\S/));
        }
    });

    it("offers unseen patch and stable releases in order and respects an acknowledged or newer version", () => {
        expect(isOlderThan("v1.7.0", "v1.7.1")).toBe(true);
        expect(isOlderThan("v1.7.1-beta.1", "v1.7.1")).toBe(true);
        expect(isOlderThan("v1.7.1", "v1.7.1")).toBe(false);
        expect(isOlderThan("v1.8.0", "v1.7.1")).toBe(false);
        expect(isOlderThan(undefined, "v1.7.1")).toBe(true);
    });
});
