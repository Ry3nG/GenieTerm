// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { shell } from "electron";
import { callWithOriginalXdgCurrentDesktopAsync } from "./emain-platform";
import { isSafeExternalUrl } from "./safe-open-util";

export async function safeOpenExternal(url: string): Promise<boolean> {
    if (!isSafeExternalUrl(url)) {
        console.warn("Blocked external URL", url);
        return false;
    }
    await callWithOriginalXdgCurrentDesktopAsync(() => shell.openExternal(url));
    return true;
}
