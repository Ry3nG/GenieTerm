// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getPathBasename, isWindowsPath, replacePathBasename } from "@/util/filepath";
import { quotePowerShellPath } from "@/util/shellquote";
import { isLocalConnName } from "@/util/util";
import { quote as shellQuote } from "shell-quote";

export function isLocalWindowsFilePath(path: string, connection: string): boolean {
    return isLocalConnName(connection) && isWindowsPath(path);
}

export function getPreviewFileName(path: string, connection: string): string {
    return getPathBasename(path, isLocalWindowsFilePath(path, connection));
}

export function getPreviewRenamePath(path: string, name: string, connection: string): string {
    return replacePathBasename(path, name, isLocalWindowsFilePath(path, connection));
}

export function quotePreviewFilePath(path: string, fullPath: string, connection: string): string {
    return isLocalWindowsFilePath(fullPath, connection) ? quotePowerShellPath(path) : shellQuote([path]);
}
