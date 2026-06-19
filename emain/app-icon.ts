// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import fs from "node:fs";
import path from "node:path";
import { getElectronAppBasePath, unamePlatform } from "./emain-platform";

export type AppIconVariant = "default" | "black" | "white";

const AppIconVariantSet = new Set<AppIconVariant>(["default", "black", "white"]);

export function normalizeAppIconVariant(variant: unknown): AppIconVariant {
    if (AppIconVariantSet.has(variant as AppIconVariant)) {
        return variant as AppIconVariant;
    }
    return "default";
}

function getAppIconFileName(variant: AppIconVariant): string {
    if (variant === "default") {
        return "genieterm-logo.png";
    }
    return `genieterm-logo-${variant}.png`;
}

function getCandidateIconPaths(fileName: string): string[] {
    const appBasePath = getElectronAppBasePath();
    return [
        path.join(appBasePath, "frontend", "logos", fileName),
        path.join(appBasePath, "public", "logos", fileName),
        path.join(appBasePath, "..", "public", "logos", fileName),
    ];
}

export function getAppIconPath(variant: unknown): string {
    const normalized = normalizeAppIconVariant(variant);
    for (const candidate of getCandidateIconPaths(getAppIconFileName(normalized))) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    for (const candidate of getCandidateIconPaths(getAppIconFileName("default"))) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return getCandidateIconPaths(getAppIconFileName("default"))[0];
}

export function applyDockIconVariant(variant: unknown): void {
    if (unamePlatform !== "darwin" || electron.app.dock == null) {
        return;
    }
    const image = electron.nativeImage.createFromPath(getAppIconPath(variant));
    if (image.isEmpty()) {
        return;
    }
    electron.app.dock.setIcon(image);
}
