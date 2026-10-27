// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getPathBasename, isWindowsPath } from "@/util/filepath";
import type { CompletionContext, CompletionItem, CompletionProvider } from "./types";

const MaxFileCompletions = 80;
const FileBaseScore = 900;

export type ListDirectoryForCompletion = (path: string, ctx: CompletionContext) => Promise<FileInfo[]>;

type SearchPathParts = {
    listPath: string;
    prefix: string;
    insertPrefix: string;
    separator: string;
    windows: boolean;
};

function usesWindowsPaths(ctx: CompletionContext): boolean {
    return isWindowsPath(ctx.cwd) || ctx.shellName === "powershell";
}

function isPathLike(value: string, windows: boolean): boolean {
    return (
        value.startsWith("/") ||
        value.startsWith(".") ||
        value.startsWith("~") ||
        (windows && /^(?:[A-Za-z]:|\\)/.test(value))
    );
}

function joinRelativePath(cwd: string, relPath: string, separator: string): string {
    if (!relPath) {
        return cwd || ".";
    }
    if (cwd === "/") {
        return `/${relPath}`;
    }
    return `${(cwd || ".").replace(separator === "\\" ? /[\\/]$/ : /\/$/, "")}${separator}${relPath}`;
}

function splitSearchPath(searchTerm: string, ctx: CompletionContext): SearchPathParts {
    const { cwd } = ctx;
    const windows = usesWindowsPaths(ctx);
    const slashIdx = windows
        ? Math.max(searchTerm.lastIndexOf("/"), searchTerm.lastIndexOf("\\"))
        : searchTerm.lastIndexOf("/");
    const separator =
        windows && (searchTerm.includes("\\") || (!searchTerm.includes("/") && cwd.includes("\\"))) ? "\\" : "/";
    const style = { separator, windows };
    if (slashIdx < 0) {
        if (windows && /^[A-Za-z]:/.test(searchTerm)) {
            return {
                ...style,
                listPath: searchTerm.slice(0, 2),
                prefix: searchTerm.slice(2),
                insertPrefix: searchTerm.slice(0, 2),
            };
        }
        return { ...style, listPath: cwd || ".", prefix: searchTerm, insertPrefix: "" };
    }
    const dirPart = searchTerm.slice(0, slashIdx);
    const prefix = searchTerm.slice(slashIdx + 1);
    const insertPrefix = searchTerm.slice(0, slashIdx + 1);
    if (windows && /^[A-Za-z]:/.test(searchTerm)) {
        return { ...style, listPath: dirPart.length === 2 ? insertPrefix : dirPart, prefix, insertPrefix };
    }
    if (searchTerm.startsWith("/") || (windows && searchTerm.startsWith("\\"))) {
        return { ...style, listPath: dirPart || separator, prefix, insertPrefix };
    }
    if (searchTerm.startsWith("~")) {
        return { ...style, listPath: dirPart || "~", prefix, insertPrefix };
    }
    return { ...style, listPath: joinRelativePath(cwd, dirPart, separator), prefix, insertPrefix };
}

function shouldCompleteFiles(ctx: CompletionContext): boolean {
    if (ctx.searchTerm.startsWith("$")) {
        return false;
    }
    if (ctx.tokenType === "option") {
        return false;
    }
    if (ctx.tokenIndex <= 0 && !isPathLike(ctx.searchTerm, usesWindowsPaths(ctx))) {
        return false;
    }
    return true;
}

function fileInfoName(fileInfo: FileInfo, windows: boolean): string {
    return fileInfo.name || getPathBasename(fileInfo.path, windows) || fileInfo.path;
}

function compareFileInfo(a: FileInfo, b: FileInfo, windows: boolean): number {
    if (Boolean(a.isdir) !== Boolean(b.isdir)) {
        return a.isdir ? -1 : 1;
    }
    return fileInfoName(a, windows).localeCompare(fileInfoName(b, windows));
}

function makeCompletionItem(fileInfo: FileInfo, parts: SearchPathParts, idx: number): CompletionItem {
    const name = fileInfoName(fileInfo, parts.windows);
    const suffix = fileInfo.isdir ? parts.separator : "";
    return {
        label: `${name}${suffix}`,
        insertText: `${parts.insertPrefix}${name}${suffix}`,
        kind: fileInfo.isdir ? "folder" : "file",
        score: FileBaseScore - idx,
    };
}

export function makeFileCompletionProvider(listDirectory: ListDirectoryForCompletion): CompletionProvider {
    return {
        id: "files",
        priority: 5,
        provideCompletions: async (ctx) => {
            if (!shouldCompleteFiles(ctx)) {
                return [];
            }
            const parts = splitSearchPath(ctx.searchTerm, ctx);
            let entries: FileInfo[];
            try {
                entries = await listDirectory(parts.listPath, ctx);
            } catch {
                return [];
            }
            return entries
                .filter((entry) => {
                    const name = fileInfoName(entry, parts.windows);
                    if (!parts.prefix.startsWith(".") && name.startsWith(".")) {
                        return false;
                    }
                    return name.toLowerCase().startsWith(parts.prefix.toLowerCase());
                })
                .sort((a, b) => compareFileInfo(a, b, parts.windows))
                .slice(0, MaxFileCompletions)
                .map((entry, idx) => makeCompletionItem(entry, parts, idx));
        },
    };
}
