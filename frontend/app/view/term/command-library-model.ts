// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { emptyCommandLibrary, type CommandLibraryChange, type CommandLibraryContext } from "@/util/commandlibrary";
import { atom, type PrimitiveAtom } from "jotai";

export type CommandLibraryOpenState = { blockid: string };

export class CommandLibraryModel {
    private static instance: CommandLibraryModel;
    libraryAtom = atom(emptyCommandLibrary());
    errorAtom = atom("");
    loadingAtom = atom(false);
    openAtom = atom(null) as PrimitiveAtom<CommandLibraryOpenState>;
    unsubscribe: () => void;
    refreshTimer: ReturnType<typeof setTimeout>;
    request = 0;

    private constructor() {}

    static getInstance(): CommandLibraryModel {
        if (!CommandLibraryModel.instance) {
            CommandLibraryModel.instance = new CommandLibraryModel();
        }
        return CommandLibraryModel.instance;
    }

    open(context: CommandLibraryContext) {
        this.unsubscribe?.();
        this.unsubscribe = getApi().onCommandLibraryChanged(() => {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = setTimeout(() => void this.refresh(), 100);
        });
        globalStore.set(this.openAtom, {
            blockid: context.blockid,
        });
        void this.refresh();
    }

    close() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        clearTimeout(this.refreshTimer);
        this.request++;
        globalStore.set(this.openAtom, null);
        globalStore.set(this.loadingAtom, false);
        globalStore.set(this.libraryAtom, emptyCommandLibrary());
        globalStore.set(this.errorAtom, "");
    }

    async refresh() {
        const request = ++this.request;
        globalStore.set(this.loadingAtom, true);
        try {
            const library = await getApi().getCommandLibrary();
            if (request !== this.request) {
                return;
            }
            globalStore.set(this.libraryAtom, library);
            globalStore.set(this.errorAtom, "");
        } catch (error) {
            if (request === this.request) {
                globalStore.set(this.errorAtom, error instanceof Error ? error.message : String(error));
            }
        } finally {
            if (request === this.request) {
                globalStore.set(this.loadingAtom, false);
            }
        }
    }

    async change(change: CommandLibraryChange): Promise<boolean> {
        try {
            await getApi().changeCommandLibrary(change);
            if (globalStore.get(this.openAtom)) {
                await this.refresh();
            }
            return !globalStore.get(this.errorAtom);
        } catch (error) {
            globalStore.set(this.errorAtom, error instanceof Error ? error.message : String(error));
            return false;
        }
    }
}
