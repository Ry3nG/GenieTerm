// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { WorkspaceTemplatePanel } from "@/app/tab/workspace-template-panel";
import { captureTemplateTab } from "@/app/tab/workspace-templates";
import { CommandLibraryModel } from "@/app/view/term/command-library-model";
import { CommandLibraryPanel } from "@/app/view/term/command-library-ui";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { applyCommandLibraryChange, emptyCommandLibrary } from "@/util/commandlibrary";
import { useEffect, useMemo, useState } from "react";
import { makeMockWaveEnv } from "../mock/mockwaveenv";

const Context = {
    blockid: "preview-terminal",
    tabid: "preview-tab",
    connection: "prod",
    cwd: "/srv/api",
    shell: "bash",
};
const SourceBlocks = [
    { oid: "a", meta: { view: "term", connection: "prod", "cmd:cwd": "/srv/api" } },
    { oid: "b", meta: { view: "term", connection: "staging", "cmd:cwd": "/srv/worker" } },
    { oid: "c", meta: { view: "preview", file: "/local/logs" } },
] as Block[];

export function WorkflowToolsPreview() {
    const [launched, setLaunched] = useState<MetaType[]>([]);
    const [inserted, setInserted] = useState("");
    const [idle, setIdle] = useState(true);
    const env = useMemo(() => {
        const tab = { oid: "new-tab", otype: "tab", layoutstate: "new-layout", blockids: [] } as Tab;
        const layout = { oid: "new-layout", otype: "layout" } as LayoutState;
        const created: MetaType[] = [];
        const client = {
            oid: "client",
            meta: {
                "workspace:template:multi": {
                    version: 1,
                    id: "multi",
                    name: "Multi-host setup",
                    tabs: [captureTemplateTab("Investigate", null, SourceBlocks)],
                },
            },
        };
        return makeMockWaveEnv({
            services: {
                client: { GetClientData: async () => client },
                object: {
                    GetObject: async (ref: string) => (ref.startsWith("tab:") ? tab : layout),
                    UpdateObject: async () => {},
                },
                workspace: {
                    CreateWorkspaceSetup: async () => {
                        created.length = 0;
                        return "new-workspace";
                    },
                    GetWorkspace: async () => ({ tabids: [tab.oid] }),
                },
            },
            rpc: {
                CreateBlockCommand: async (_client, data) => {
                    created.push(data.blockdef.meta);
                    return `block:fresh-${created.length}`;
                },
            },
            electron: { switchWorkspace: () => setLaunched([...created]) },
        });
    }, []);

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
            <div className="mx-auto max-w-sm rounded border border-border bg-panel">
                <WaveEnvContext.Provider value={env}>
                    <WorkspaceTemplatePanel workspace={{ name: "Source workspace" } as Workspace} />
                </WaveEnvContext.Provider>
            </div>
            <output aria-label="Launched pane destinations" className="block break-all text-xs">
                {JSON.stringify(launched)}
            </output>
            <div className="my-3 flex flex-wrap gap-3">
                <button className="cursor-pointer" onClick={() => CommandLibraryModel.getInstance().open(Context)}>
                    Open command library
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
