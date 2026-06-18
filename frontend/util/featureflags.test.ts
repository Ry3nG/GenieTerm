// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { shouldShowAppBuilderSurface } from "./featureflags";

describe("featureflags", () => {
    it("shows app-builder surfaces only when explicitly enabled", () => {
        expect(shouldShowAppBuilderSurface(true)).toBe(true);
        expect(shouldShowAppBuilderSurface(false)).toBe(false);
        expect(shouldShowAppBuilderSurface(undefined)).toBe(false);
        expect(shouldShowAppBuilderSurface("true")).toBe(false);
    });
});
