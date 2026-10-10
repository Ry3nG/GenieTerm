// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/store/global";

let localHomeDir: string = undefined;

// HOME of the local machine; remote paths are shown as reported because their home isn't known here
export function getLocalHomeDir(): string {
    if (localHomeDir === undefined) {
        try {
            localHomeDir = getApi().getEnv("HOME") ?? null;
        } catch {
            localHomeDir = null;
        }
    }
    return localHomeDir;
}
