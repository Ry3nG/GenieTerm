// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A .deb (or any non-AppImage Linux install) belongs to the system package manager, so GenieTerm
// tells the user about new versions instead of downloading and replacing files it doesn't own.
// AppImage builds update themselves like macOS and Windows.
export function usesPackageManagerUpdates(
    platform: string = process.platform,
    env: Record<string, string | undefined> = process.env
): boolean {
    return platform == "linux" && !env.APPIMAGE;
}
