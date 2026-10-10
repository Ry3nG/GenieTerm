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

const RootPath = "/Users/demo/GenieTerm";
const Today = new Date();
Today.setHours(0, 21, 0, 0);
const Yesterday = new Date(Today);
Yesterday.setDate(Today.getDate() - 1);
Yesterday.setHours(20, 9);
const Entries: FileInfo[] = [
    {
        path: `${RootPath}/src`,
        name: "src",
        isdir: true,
        mimetype: "directory",
        modestr: "drwxr-xr-x",
        modtime: Today.getTime(),
    },
    {
        path: `${RootPath}/README.md`,
        name: "README.md",
        size: 5130,
        mimetype: "text/markdown; charset=utf-8",
        modestr: "-rw-r--r--",
        modtime: Today.getTime(),
    },
    {
        path: `${RootPath}/package.json`,
        name: "package.json",
        size: 206,
        mimetype: "application/json",
        modestr: "-rw-r--r--",
        modtime: Yesterday.getTime(),
    },
    {
        path: `${RootPath}/release-notes-with-a-long-descriptive-name.md`,
        name: "release-notes-with-a-long-descriptive-name.md",
        size: 12400000,
        mimetype: "text/markdown",
        modestr: "-rw-r--r--",
        modtime: new Date(Today.getFullYear(), 0, 5, 20, 52).getTime(),
    },
    {
        path: `${RootPath}/archive.pdf`,
        name: "archive.pdf",
        size: 1200000000,
        mimetype: "application/pdf",
        modestr: "-rw-r--r--",
        modtime: new Date(Today.getFullYear() - 1, 6, 5).getTime(),
    },
    {
        path: `${RootPath}/yarn.lock`,
        name: "yarn.lock",
        size: 129000,
        mimetype: "text/plain",
        modestr: "-rw-r--r--",
        modtime: Today.getTime(),
    },
    {
        path: `${RootPath}/current`,
        name: "current",
        mimetype: "inode/symlink",
        modestr: "Lrwxr-xr-x",
        size: 12,
        modtime: Yesterday.getTime(),
    },
    ...Array.from(
        { length: 250 },
        (_, index): FileInfo => ({
            path: `${RootPath}/component-${String(index).padStart(3, "0")}.tsx`,
            name: `component-${String(index).padStart(3, "0")}.tsx`,
            size: 1950 + index * 100,
            mimetype: "text/plain",
            modestr: "-rw-r--r--",
            modtime: Yesterday.getTime(),
        })
    ),
];

export function FilesDirectoryPreview() {
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
            statFile: atom((get) => ({ path: get(pathAtom), dir: "/Users/demo", isdir: true })),
            showHiddenFiles: atom(true),
            treeViewMode: atom(false),
            treeExpanded: atom<string[]>([]),
            directorySearchActive: atom(false),
            refreshVersion: atom(0),
            errorMsgAtom: atom(null),
            formatRemoteUri: async (path: string) => path,
            goHistory: (path: string) => {
                setOpened(path);
                if (path === "/Users/demo" || Entries.find((entry) => entry.path === path)?.isdir) {
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
                        <span>Files · 257 entries · resize columns, sort, or use arrow keys and Enter</span>
                        <button
                            className="cursor-pointer rounded border border-border px-3 py-1"
                            onClick={() => globalStore.set(model.treeViewMode, !treeView)}
                        >
                            {treeView ? "List view" : "Tree view"}
                        </button>
                    </div>
                    <div
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
