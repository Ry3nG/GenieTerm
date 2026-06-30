// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const MaxReleaseNotesLength = 1200;

type ReleaseNoteInfo = {
    version?: string;
    note?: string;
};

export type ReleaseNotesInput = string | ReleaseNoteInfo[] | null | undefined;

export function formatReleaseNotes(releaseNotes: ReleaseNotesInput): string | null {
    if (releaseNotes == null) {
        return null;
    }
    if (typeof releaseNotes === "string") {
        return sanitizeReleaseNoteText(releaseNotes);
    }
    return sanitizeReleaseNoteText(
        releaseNotes
            .map((noteInfo) => {
                const note = sanitizeReleaseNoteText(noteInfo.note);
                if (!note) {
                    return null;
                }
                if (!noteInfo.version) {
                    return note;
                }
                return `${noteInfo.version}: ${note}`;
            })
            .filter(Boolean)
            .join("\n\n")
    );
}

function sanitizeReleaseNoteText(rawNote: string | null | undefined): string | null {
    if (!rawNote) {
        return null;
    }
    const text = trimToDialogLength(
        decodeHtmlEntities(
            rawNote
                .replace(/\r\n/g, "\n")
                .replace(/<!--[\s\S]*?-->/g, "")
                .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<li\b[^>]*>/gi, "\n")
                .replace(/<\/li>/gi, "")
                .replace(
                    /<\/?(p|div|section|article|header|footer|h[1-6]|ul|ol|blockquote|pre|tr|table)\b[^>]*>/gi,
                    "\n"
                )
                .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
                .replace(/<[^>]*>/g, "")
                .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
                .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                .replace(/(^|\s)#{1,6}\s+/g, "$1")
                .replace(/(^|\s)>+\s?/gm, "$1")
                .replace(/(^|\s)[*_~`]{1,3}([^*_~`\n]+)[*_~`]{1,3}/g, "$1$2")
                .replace(/[ \t]+/g, " ")
                .replace(/\n[ \t]+/g, "\n")
                .replace(/[ \t]+\n/g, "\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim()
        )
    );
    return text || null;
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&#(\d+);/g, (_, codePoint: string) => String.fromCodePoint(Number(codePoint)))
        .replace(/&#x([0-9a-f]+);/gi, (_, codePoint: string) => String.fromCodePoint(parseInt(codePoint, 16)))
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function trimToDialogLength(text: string): string {
    if (text.length <= MaxReleaseNotesLength) {
        return text;
    }
    const trimmed = text.slice(0, MaxReleaseNotesLength);
    const lastLineBreak = trimmed.lastIndexOf("\n");
    if (lastLineBreak > MaxReleaseNotesLength * 0.6) {
        return `${trimmed.slice(0, lastLineBreak).trim()}...`;
    }
    return `${trimmed.trim()}...`;
}
