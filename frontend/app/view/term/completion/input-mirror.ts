// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TermInputBuffer } from "./types";

const BracketedPasteStart = "\x1b[200~";
const BracketedPasteEnd = "\x1b[201~";

function previousCodePointIndex(text: string, index: number): number {
    if (index <= 0) {
        return 0;
    }
    const chars = Array.from(text.slice(0, index));
    chars.pop();
    return chars.join("").length;
}

function nextCodePointIndex(text: string, index: number): number {
    if (index >= text.length) {
        return text.length;
    }
    const [next] = Array.from(text.slice(index));
    return index + (next?.length ?? 0);
}

function previousWordIndex(text: string, index: number): number {
    let cur = index;
    while (cur > 0 && /\s/u.test(text.slice(previousCodePointIndex(text, cur), cur))) {
        cur = previousCodePointIndex(text, cur);
    }
    while (cur > 0 && !/\s/u.test(text.slice(previousCodePointIndex(text, cur), cur))) {
        cur = previousCodePointIndex(text, cur);
    }
    return cur;
}

function nextWordIndex(text: string, index: number): number {
    let cur = index;
    while (cur < text.length && /\s/u.test(text.slice(cur, nextCodePointIndex(text, cur)))) {
        cur = nextCodePointIndex(text, cur);
    }
    while (cur < text.length && !/\s/u.test(text.slice(cur, nextCodePointIndex(text, cur)))) {
        cur = nextCodePointIndex(text, cur);
    }
    return cur;
}

function insertText(buffer: TermInputBuffer, text: string): TermInputBuffer {
    return {
        text: buffer.text.slice(0, buffer.cursorIndex) + text + buffer.text.slice(buffer.cursorIndex),
        cursorIndex: buffer.cursorIndex + text.length,
    };
}

function deleteRange(buffer: TermInputBuffer, start: number, end: number): TermInputBuffer {
    return {
        text: buffer.text.slice(0, start) + buffer.text.slice(end),
        cursorIndex: start,
    };
}

export function emptyPromptInputBuffer(): TermInputBuffer {
    return { text: "", cursorIndex: 0 };
}

export function applyPromptInputData(buffer: TermInputBuffer, data: string): TermInputBuffer | null {
    let next = buffer;
    for (let idx = 0; idx < data.length; ) {
        if (data.startsWith(BracketedPasteStart, idx)) {
            const pasteStart = idx + BracketedPasteStart.length;
            const pasteEnd = data.indexOf(BracketedPasteEnd, pasteStart);
            if (pasteEnd === -1) {
                return null;
            }
            const pastedText = data.slice(pasteStart, pasteEnd);
            if (/[\r\n]/u.test(pastedText)) {
                return emptyPromptInputBuffer();
            }
            next = insertText(next, pastedText);
            idx = pasteEnd + BracketedPasteEnd.length;
            continue;
        }

        const char = data[idx];
        if (char === "\r" || char === "\n" || char === "\x03") {
            return emptyPromptInputBuffer();
        }
        if (char === "\t" || char === "\x10" || char === "\x0e" || char === "\x12") {
            return null;
        }
        if (char === "\x01") {
            next = { ...next, cursorIndex: 0 };
            idx++;
            continue;
        }
        if (char === "\x05") {
            next = { ...next, cursorIndex: next.text.length };
            idx++;
            continue;
        }
        if (char === "\x0b") {
            next = { text: next.text.slice(0, next.cursorIndex), cursorIndex: next.cursorIndex };
            idx++;
            continue;
        }
        if (char === "\x15") {
            next = emptyPromptInputBuffer();
            idx++;
            continue;
        }
        if (char === "\x17") {
            next = deleteRange(next, previousWordIndex(next.text, next.cursorIndex), next.cursorIndex);
            idx++;
            continue;
        }
        if (char === "\x7f" || char === "\b") {
            next = deleteRange(next, previousCodePointIndex(next.text, next.cursorIndex), next.cursorIndex);
            idx++;
            continue;
        }
        if (data.startsWith("\x1b[D", idx)) {
            next = { ...next, cursorIndex: previousCodePointIndex(next.text, next.cursorIndex) };
            idx += 3;
            continue;
        }
        if (data.startsWith("\x1b[C", idx)) {
            next = { ...next, cursorIndex: nextCodePointIndex(next.text, next.cursorIndex) };
            idx += 3;
            continue;
        }
        if (data.startsWith("\x1b[H", idx) || data.startsWith("\x1b[1~", idx)) {
            next = { ...next, cursorIndex: 0 };
            idx += data.startsWith("\x1b[1~", idx) ? 4 : 3;
            continue;
        }
        if (data.startsWith("\x1b[F", idx) || data.startsWith("\x1b[4~", idx)) {
            next = { ...next, cursorIndex: next.text.length };
            idx += data.startsWith("\x1b[4~", idx) ? 4 : 3;
            continue;
        }
        if (data.startsWith("\x1b[3~", idx)) {
            next = deleteRange(next, next.cursorIndex, nextCodePointIndex(next.text, next.cursorIndex));
            idx += 4;
            continue;
        }
        if (data.startsWith("\x1bb", idx)) {
            next = { ...next, cursorIndex: previousWordIndex(next.text, next.cursorIndex) };
            idx += 2;
            continue;
        }
        if (data.startsWith("\x1bf", idx)) {
            next = { ...next, cursorIndex: nextWordIndex(next.text, next.cursorIndex) };
            idx += 2;
            continue;
        }
        if (data.startsWith("\x1b\x7f", idx)) {
            next = deleteRange(next, previousWordIndex(next.text, next.cursorIndex), next.cursorIndex);
            idx += 2;
            continue;
        }
        if (char === "\x1b") {
            return null;
        }
        if (char < " ") {
            idx++;
            continue;
        }
        const [codePoint] = Array.from(data.slice(idx));
        next = insertText(next, codePoint);
        idx += codePoint.length;
    }
    return next;
}
