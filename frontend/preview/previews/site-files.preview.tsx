// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { DirectoryPreview } from "@/app/view/preview/preview-directory";
import type { PreviewModel } from "@/app/view/preview/preview-model";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { keydownWrapper } from "@/util/keyutil";
import { atom, useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { makeMockWaveEnv } from "../mock/mockwaveenv";

const RootPath = "/home/demo/vision-lab";
const Modified = new Date("2026-10-12T09:30:00Z").getTime();
const Entries: FileInfo[] = [
    { name: "configs", isdir: true, mimetype: "directory", size: 0 },
    { name: "datasets", isdir: true, mimetype: "directory", size: 0 },
    { name: "runs", isdir: true, mimetype: "directory", size: 0 },
    { name: "README.md", mimetype: "text/markdown", size: 5130 },
    { name: "requirements.txt", mimetype: "text/plain", size: 206 },
    { name: "train.py", mimetype: "text/x-python", size: 12240 },
    { name: "validate.py", mimetype: "text/x-python", size: 3200 },
    { name: "results.csv", mimetype: "text/csv", size: 360400 },
].map((entry) => ({
    ...entry,
    path: `${RootPath}/${entry.name}`,
    modestr: entry.isdir ? "drwxr-xr-x" : "-rw-r--r--",
    modtime: Modified,
}));

export function SiteFilesPreview() {
    const [opened, setOpened] = useState("");
    const model = useMemo(() => {
        const pathAtom = atom(RootPath);
        const env = makeMockWaveEnv({
            settings: { "preview:fileview": "list" },
            rpcStreaming: {
                FileListStreamCommand: async function* () {
                    yield { fileinfo: Entries };
                },
            },
        });
        return {
            env,
            connection: atom(""),
            blockAtom: atom({ meta: {} } as Block),
            statFilePath: pathAtom,
            statFile: atom((get) => ({ path: get(pathAtom), dir: "/home/demo", isdir: true })),
            showHiddenFiles: atom(true),
            treeViewMode: atom(false),
            treeExpanded: atom<string[]>([]),
            directorySearchActive: atom(false),
            refreshVersion: atom(0),
            errorMsgAtom: atom(null),
            formatRemoteUri: async (path: string) => path,
            goHistory: (path: string) => {
                setOpened(path);
                if (path === "/home/demo" || Entries.find((entry) => entry.path === path)?.isdir) {
                    globalStore.set(pathAtom, path);
                }
            },
        } as unknown as PreviewModel & { env: ReturnType<typeof makeMockWaveEnv> };
    }, []);
    const treeView = useAtomValue(model.treeViewMode);

    return (
        <WaveEnvContext.Provider value={model.env}>
            <DndProvider backend={HTML5Backend}>
                <div className="flex w-full flex-col gap-3 px-6 py-4">
                    <div className="flex items-center justify-between text-xs text-muted">
                        <span>Files · Sample project for the website</span>
                        <button
                            className="cursor-pointer rounded border border-border px-3 py-1"
                            onClick={() => globalStore.set(model.treeViewMode, !treeView)}
                        >
                            {treeView ? "List view" : "Tree view"}
                        </button>
                    </div>
                    <div
                        data-site-files
                        className="h-[560px] overflow-hidden rounded-lg border border-border bg-panel outline-none"
                        tabIndex={0}
                        onKeyDown={keydownWrapper((event) => model.directoryKeyDownHandler?.(event) ?? false)}
                    >
                        <DirectoryPreview model={model} />
                    </div>
                    <div className="text-xs text-muted">{opened ? `Opened: ${opened}` : "No selection on open"}</div>
                </div>
            </DndProvider>
        </WaveEnvContext.Provider>
    );
}
