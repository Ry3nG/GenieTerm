// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/store/global";
import * as jotai from "jotai";
import { makeCompletionAcceptSequence } from "./accept";
import { getCompletionSuffix } from "./ghost";
import type { CompletionContext, CompletionItem, TermInputBuffer } from "./types";

export type CompletionStatus = "idle" | "loading" | "ready" | "error";

export type CompletionServiceLike = {
    provideCompletions(ctx: CompletionContext): Promise<CompletionItem[]>;
};

export class TermCompletionModel {
    openAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    itemsAtom = jotai.atom<CompletionItem[]>([]) as jotai.PrimitiveAtom<CompletionItem[]>;
    selectedIndexAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
    selectionExplicitAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    statusAtom = jotai.atom<CompletionStatus>("idle") as jotai.PrimitiveAtom<CompletionStatus>;
    contextAtom = jotai.atom(null) as jotai.PrimitiveAtom<CompletionContext>;
    manualRequestVersionAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
    requestCounter = 0;
    // A finished command placed at the prompt (by Command AI) shouldn't pop up
    // suggestions for itself; editing it brings them back.
    suppressedAutoText: string = null;

    suppressAutoFor(text: string) {
        this.suppressedAutoText = text;
        this.dismiss();
    }

    async requestCompletions(service: CompletionServiceLike, ctx: CompletionContext): Promise<void> {
        const requestId = ++this.requestCounter;
        globalStore.set(this.statusAtom, "loading");
        let items: CompletionItem[] = [];
        try {
            items = await service.provideCompletions(ctx);
        } catch {
            if (requestId === this.requestCounter) {
                this.dismiss();
                globalStore.set(this.statusAtom, "error");
            }
            return;
        }
        if (requestId !== this.requestCounter) {
            return;
        }
        if (items.length === 0) {
            this.dismiss();
            return;
        }
        globalStore.set(this.contextAtom, ctx);
        globalStore.set(this.itemsAtom, items);
        globalStore.set(this.selectedIndexAtom, 0);
        globalStore.set(this.selectionExplicitAtom, ctx.requestKind === "manual");
        globalStore.set(this.openAtom, true);
        globalStore.set(this.statusAtom, "ready");
    }

    triggerManualRequest(): void {
        globalStore.set(this.manualRequestVersionAtom, globalStore.get(this.manualRequestVersionAtom) + 1);
    }

    dismiss(): void {
        globalStore.set(this.openAtom, false);
        globalStore.set(this.itemsAtom, []);
        globalStore.set(this.selectedIndexAtom, 0);
        globalStore.set(this.selectionExplicitAtom, false);
        globalStore.set(this.statusAtom, "idle");
    }

    moveSelection(delta: number): void {
        const items = globalStore.get(this.itemsAtom);
        if (items.length === 0) {
            return;
        }
        const selectedIndex = globalStore.get(this.selectedIndexAtom);
        globalStore.set(this.selectedIndexAtom, (selectedIndex + delta + items.length) % items.length);
        globalStore.set(this.selectionExplicitAtom, true);
    }

    shouldAcceptSelectedFromKey(): boolean {
        return globalStore.get(this.selectionExplicitAtom);
    }

    // Drops any in-flight request and closes the popup; used whenever the prompt input
    // changes so a result computed for older input can never be shown or accepted.
    invalidate(): void {
        this.requestCounter++;
        this.dismiss();
    }

    getSelectedItem(): CompletionItem | null {
        return globalStore.get(this.itemsAtom)[globalStore.get(this.selectedIndexAtom)] ?? null;
    }

    isContextCurrent(currentInput: TermInputBuffer | null): boolean {
        const ctx = globalStore.get(this.contextAtom);
        return (
            ctx != null &&
            currentInput != null &&
            ctx.inputText === currentInput.text &&
            ctx.cursorIndex === currentInput.cursorIndex
        );
    }

    // ArrowRight is also plain cursor movement, so it only accepts when the cursor sits at
    // the end of the line and the selection actually extends what was typed.
    canAcceptWithArrowRight(currentInput: TermInputBuffer | null): boolean {
        const ctx = globalStore.get(this.contextAtom);
        const item = this.getSelectedItem();
        if (item == null || !this.isContextCurrent(currentInput)) {
            return false;
        }
        if (currentInput.cursorIndex !== currentInput.text.length) {
            return false;
        }
        return getCompletionSuffix(ctx.searchTerm, item) !== "";
    }

    acceptSelected(sendData: (data: string) => void, currentInput: TermInputBuffer | null): boolean {
        const ctx = globalStore.get(this.contextAtom);
        const item = this.getSelectedItem();
        if (item == null || ctx == null) {
            return false;
        }
        if (!this.isContextCurrent(currentInput)) {
            this.invalidate();
            return false;
        }
        sendData(makeCompletionAcceptSequence(ctx, item));
        this.dismiss();
        return true;
    }
}
