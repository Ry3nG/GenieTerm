// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CurrentOnboardingVersion, isOnboardingCurrent } from "./onboarding-common";

describe("isOnboardingCurrent", () => {
    it("treats the current GenieTerm onboarding version as done", () => {
        expect(isOnboardingCurrent(CurrentOnboardingVersion)).toBe(true);
        expect(isOnboardingCurrent("v0.4.80")).toBe(true);
    });

    it("treats Wave-era leftover lastversion values as already onboarded", () => {
        expect(isOnboardingCurrent("v0.12.0")).toBe(true);
        expect(isOnboardingCurrent("v0.14.5")).toBe(true);
    });

    it("still shows notes for earlier GenieTerm versions after the fork reset", () => {
        expect(isOnboardingCurrent("v0.0.0")).toBe(false);
        expect(isOnboardingCurrent("v0.2.0")).toBe(false);
        expect(isOnboardingCurrent("v0.4.79")).toBe(false);
    });
});
