// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type AppIconVariant = "default" | "black" | "white";

const AppIconVariantSet = new Set<AppIconVariant>(["default", "black", "white"]);

export function normalizeAppIconVariant(variant: unknown): AppIconVariant {
    if (AppIconVariantSet.has(variant as AppIconVariant)) {
        return variant as AppIconVariant;
    }
    return "default";
}
