// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionContext, CompletionItem } from "./types";

const Backspace = "\x7f";
// Forward-delete (ESC [ 3 ~) is unbound in a stock zsh and inserts a literal "~", so the
// token suffix is removed by moving right over it and backspacing; arrow keys and
// backspace work in the default bash, zsh and fish keymaps.
const CursorRight = "\x1b[C";

function charCount(value: string): number {
    return Array.from(value).length;
}

export function makeCompletionAcceptSequence(ctx: CompletionContext, item: CompletionItem): string {
    const token = ctx.tokenIndex >= 0 && ctx.tokenIndex < ctx.tokens.length ? ctx.tokens[ctx.tokenIndex] : null;
    const replaceStart = item.replaceStart ?? token?.start ?? ctx.cursorIndex;
    const replaceEnd = item.replaceEnd ?? token?.end ?? ctx.cursorIndex;
    const suffixDeleteCount = charCount(ctx.inputText.slice(ctx.cursorIndex, replaceEnd));
    const prefixDeleteCount = charCount(ctx.inputText.slice(replaceStart, ctx.cursorIndex));
    return (
        CursorRight.repeat(suffixDeleteCount) +
        Backspace.repeat(suffixDeleteCount + prefixDeleteCount) +
        item.insertText
    );
}
