// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { CommandLibraryModel } from "@/app/view/term/command-library-model";
import { CommandLibraryPanel } from "@/app/view/term/command-library-ui";
import { applyCommandLibraryChange, emptyCommandLibrary } from "@/util/commandlibrary";
import { useEffect, useState } from "react";

const Context = {
    blockid: "preview-terminal",
    tabid: "preview-tab",
    connection: "prod",
    cwd: "/srv/api",
    shell: "bash",
};
export function WorkflowToolsPreview() {
    const [inserted, setInserted] = useState("");
    const [idle, setIdle] = useState(true);
    useEffect(() => {
        const api = getApi();
        const original = {
            getCommandLibrary: api.getCommandLibrary,
            changeCommandLibrary: api.changeCommandLibrary,
            onCommandLibraryChanged: api.onCommandLibraryChanged,
        };
        let library = emptyCommandLibrary();
        const listeners = new Set<(revision: number) => void>();
        library = applyCommandLibraryChange(library, {
            type: "record",
            entry: {
                ...Context,
                id: "history-one",
                commandblockid: 1,
                command: "printf 'hello world'",
                startts: 1000,
                donets: 2000,
                exitcode: 0,
                status: "success",
            },
        });
        api.getCommandLibrary = async () => library;
        api.changeCommandLibrary = async (change) => {
            library = applyCommandLibraryChange(library, change);
            listeners.forEach((listener) => listener(library.revision));
        };
        api.onCommandLibraryChanged = (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        };
        CommandLibraryModel.getInstance().open(Context);
        return () => {
            CommandLibraryModel.getInstance().close();
            Object.assign(api, original);
        };
    }, []);

    return (
        <div className="w-full max-w-[1000px] px-4 py-4">
            <div className="my-3 flex flex-wrap gap-3">
                <button className="cursor-pointer" onClick={() => CommandLibraryModel.getInstance().open(Context)}>
                    Open command history
                </button>
                <label>
                    <input type="checkbox" checked={idle} onChange={(event) => setIdle(event.target.checked)} />
                    Idle terminal
                </label>
            </div>
            <output aria-label="Inserted command" className="block break-all text-xs">
                {inserted}
            </output>
            <div className="relative h-[680px]">
                <CommandLibraryPanel
                    context={Context}
                    onInsert={(command) => {
                        if (!idle) return false;
                        setInserted(command);
                        return true;
                    }}
                    onJump={() => false}
                    hasOutput={() => false}
                />
            </div>
        </div>
    );
}
