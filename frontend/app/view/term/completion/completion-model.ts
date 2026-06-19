// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/store/global";
import * as jotai from "jotai";
import { makeCompletionAcceptSequence } from "./accept";
import type { CompletionContext, CompletionItem } from "./types";

export type CompletionStatus = "idle" | "loading" | "ready" | "error";

export type CompletionServiceLike = {
    provideCompletions(ctx: CompletionContext): Promise<CompletionItem[]>;
};

export class TermCompletionModel {
    openAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    itemsAtom = jotai.atom<CompletionItem[]>([]) as jotai.PrimitiveAtom<CompletionItem[]>;
    selectedIndexAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
    statusAtom = jotai.atom<CompletionStatus>("idle") as jotai.PrimitiveAtom<CompletionStatus>;
    contextAtom = jotai.atom(null) as jotai.PrimitiveAtom<CompletionContext>;
    manualRequestVersionAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
    requestCounter = 0;

    async requestCompletions(service: CompletionServiceLike, ctx: CompletionContext): Promise<void> {
        const requestId = ++this.requestCounter;
        globalStore.set(this.statusAtom, "loading");
        globalStore.set(this.contextAtom, ctx);
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
        globalStore.set(this.itemsAtom, items);
        globalStore.set(this.selectedIndexAtom, 0);
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
        globalStore.set(this.statusAtom, "idle");
    }

    moveSelection(delta: number): void {
        const items = globalStore.get(this.itemsAtom);
        if (items.length === 0) {
            return;
        }
        const selectedIndex = globalStore.get(this.selectedIndexAtom);
        globalStore.set(this.selectedIndexAtom, (selectedIndex + delta + items.length) % items.length);
    }

    acceptSelected(sendData: (data: string) => void): boolean {
        const items = globalStore.get(this.itemsAtom);
        const ctx = globalStore.get(this.contextAtom);
        const selectedIndex = globalStore.get(this.selectedIndexAtom);
        const item = items[selectedIndex];
        if (item == null || ctx == null) {
            return false;
        }
        sendData(makeCompletionAcceptSequence(ctx, item));
        this.dismiss();
        return true;
    }
}
