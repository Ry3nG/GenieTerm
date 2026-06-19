// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionContext, CompletionItem, CompletionProvider } from "./types";

const MaxFileCompletions = 80;
const FileBaseScore = 900;

export type ListDirectoryForCompletion = (path: string, ctx: CompletionContext) => Promise<FileInfo[]>;

type SearchPathParts = {
    listPath: string;
    prefix: string;
    insertPrefix: string;
};

function isPathLike(value: string): boolean {
    return value.startsWith("/") || value.startsWith(".") || value.startsWith("~");
}

function joinRelativePath(cwd: string, relPath: string): string {
    if (!relPath) {
        return cwd || ".";
    }
    if (cwd === "/") {
        return `/${relPath}`;
    }
    return `${(cwd || ".").replace(/\/$/, "")}/${relPath}`;
}

function splitSearchPath(searchTerm: string, cwd: string): SearchPathParts {
    const slashIdx = searchTerm.lastIndexOf("/");
    if (slashIdx < 0) {
        return { listPath: cwd || ".", prefix: searchTerm, insertPrefix: "" };
    }
    const dirPart = searchTerm.slice(0, slashIdx);
    const prefix = searchTerm.slice(slashIdx + 1);
    const insertPrefix = searchTerm.slice(0, slashIdx + 1);
    if (searchTerm.startsWith("/")) {
        return { listPath: dirPart || "/", prefix, insertPrefix };
    }
    if (searchTerm.startsWith("~")) {
        return { listPath: dirPart || "~", prefix, insertPrefix };
    }
    return { listPath: joinRelativePath(cwd, dirPart), prefix, insertPrefix };
}

function shouldCompleteFiles(ctx: CompletionContext): boolean {
    if (ctx.searchTerm.startsWith("$")) {
        return false;
    }
    if (ctx.tokenType === "option") {
        return false;
    }
    if (ctx.tokenIndex <= 0 && !isPathLike(ctx.searchTerm)) {
        return false;
    }
    return true;
}

function fileInfoName(fileInfo: FileInfo): string {
    return fileInfo.name || fileInfo.path.split("/").filter(Boolean).at(-1) || fileInfo.path;
}

function compareFileInfo(a: FileInfo, b: FileInfo): number {
    if (Boolean(a.isdir) !== Boolean(b.isdir)) {
        return a.isdir ? -1 : 1;
    }
    return fileInfoName(a).localeCompare(fileInfoName(b));
}

function makeCompletionItem(fileInfo: FileInfo, parts: SearchPathParts, idx: number): CompletionItem {
    const name = fileInfoName(fileInfo);
    const suffix = fileInfo.isdir ? "/" : "";
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
            const parts = splitSearchPath(ctx.searchTerm, ctx.cwd);
            let entries: FileInfo[];
            try {
                entries = await listDirectory(parts.listPath, ctx);
            } catch {
                return [];
            }
            return entries
                .filter((entry) => {
                    const name = fileInfoName(entry);
                    if (!parts.prefix.startsWith(".") && name.startsWith(".")) {
                        return false;
                    }
                    return name.toLowerCase().startsWith(parts.prefix.toLowerCase());
                })
                .sort(compareFileInfo)
                .slice(0, MaxFileCompletions)
                .map((entry, idx) => makeCompletionItem(entry, parts, idx));
        },
    };
}
