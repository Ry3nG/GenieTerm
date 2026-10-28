// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CurrentOnboardingVersion, isOnboardingCurrent } from "./onboarding-common";

describe("isOnboardingCurrent", () => {
    it("treats the current GenieTerm onboarding version as done", () => {
        expect(isOnboardingCurrent(CurrentOnboardingVersion)).toBe(true);
        expect(isOnboardingCurrent("v1.6.1")).toBe(true);
        expect(isOnboardingCurrent("v1.7.0")).toBe(true);
    });

    it("offers the feature tour to users whose last guide predates 1.6", () => {
        expect(isOnboardingCurrent("v1.0.0")).toBe(false);
        expect(isOnboardingCurrent("v1.1.0")).toBe(false);
        expect(isOnboardingCurrent("v1.2.0")).toBe(false);
        expect(isOnboardingCurrent("v1.3.0")).toBe(false);
        expect(isOnboardingCurrent("v1.3.2")).toBe(false);
        expect(isOnboardingCurrent("v1.4.0")).toBe(false);
        expect(isOnboardingCurrent("v1.5.1")).toBe(false);
    });

    it("does not let legacy Wave markers suppress new GenieTerm features forever", () => {
        expect(isOnboardingCurrent("v0.12.0")).toBe(false);
        expect(isOnboardingCurrent("v0.14.5")).toBe(false);
    });

    it("still shows notes for earlier GenieTerm versions after the fork reset", () => {
        expect(isOnboardingCurrent("v0.0.0")).toBe(false);
        expect(isOnboardingCurrent("v0.2.0")).toBe(false);
        expect(isOnboardingCurrent("v0.4.80")).toBe(false);
        expect(isOnboardingCurrent("v0.5.0")).toBe(false);
    });
});
