// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore } from "@/store/global";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { FloatingPortal, VirtualElement, flip, offset, shift, useFloating } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import * as React from "react";
import { blockHasCommand, type CmdBlock } from "../cmdblocks";
import type { TermViewModel } from "../term-model";
import type { TermWrap } from "../termwrap";
import { makeAICompletionProvider } from "./ai-provider";
import { TermCompletionService } from "./completion-service";
import { figSpecExists, makeFigStaticCompletionProvider } from "./fig-static-provider";
import { makeFileCompletionProvider, type ListDirectoryForCompletion } from "./file-provider";
import { makeHelpFallbackCompletionProvider } from "./help-provider";
import { makePathCommandCompletionProvider } from "./path-provider";
import { makeCompletionGhostText } from "./ghost";
import { makeHistoryCompletionProvider } from "./history-provider";
import { buildCompletionContext } from "./tokenizer";
import type { CompletionItem, ShellType, TermInputBuffer } from "./types";

const CompletionDebounceMs = 90;
const MaxRecentCommands = 80;

function getTerminalCursorMetrics(termWrap: TermWrap | null): { x: number; y: number; cellHeight: number } {
    const terminal = termWrap?.terminal;
    const termEl = terminal?.element;
    if (terminal == null || termEl == null) {
        return { x: 0, y: 0, cellHeight: 16 };
    }
    const core = (terminal as any)._core;
    const cell = core?._renderService?.dimensions?.css?.cell;
    const cellWidth = cell?.width ?? 8;
    const cellHeight = cell?.height ?? 16;
    const screenEl = termEl.querySelector(".xterm-screen") as HTMLElement;
    const rect = (screenEl ?? termEl).getBoundingClientRect();
    return {
        x: rect.left + terminal.buffer.active.cursorX * cellWidth,
        y: rect.top + (terminal.buffer.active.cursorY + 1) * cellHeight,
        cellHeight,
    };
}

async function listDirectoryForCompletion(path: string, ctx: { connId: string }): Promise<FileInfo[]> {
    const entries: FileInfo[] = [];
    const remotePath = formatRemoteUri(path, ctx.connId || "local");
    const stream = RpcApi.FileListStreamCommand(TabRpcClient, { path: remotePath, opts: { limit: 200 } }, null);
    for await (const chunk of stream) {
        if (chunk?.fileinfo) {
            entries.push(...chunk.fileinfo);
        }
    }
    return entries;
}

async function runCompletionGenerator(req: { command: string; args: string[]; cwd: string; connId: string }) {
    const rtn = await RpcApi.RunCompletionGenCommand(TabRpcClient, {
        connname: req.connId || "",
        cwd: req.cwd,
        command: req.command,
        args: req.args,
    });
    return { stdout: rtn.stdout, supported: rtn.supported };
}

function recentCommandsFromBlocks(cmdBlocks: CmdBlock[]): string[] {
    return [...(cmdBlocks ?? [])]
        .reverse()
        .filter(blockHasCommand)
        .map((block) => block.command.trim())
        .slice(0, MaxRecentCommands);
}

function itemIconClass(kind: CompletionItem["kind"]): string {
    if (kind === "folder") {
        return "fa-solid fa-folder";
    }
    if (kind === "file") {
        return "fa-regular fa-file";
    }
    if (kind === "history") {
        return "fa-solid fa-clock-rotate-left";
    }
    if (kind === "flag") {
        return "fa-solid fa-minus";
    }
    return "fa-solid fa-terminal";
}

interface TermCompletionProps {
    model: TermViewModel;
    blockData: Block;
    termWrap: TermWrap | null;
}

export function TermCompletion({ model, blockData, termWrap }: TermCompletionProps) {
    const completionModel = model.completionModel;
    const open = useAtomValue(completionModel.openAtom);
    const items = useAtomValue(completionModel.itemsAtom);
    const selectedIndex = useAtomValue(completionModel.selectedIndexAtom);
    const manualRequestVersion = useAtomValue(completionModel.manualRequestVersionAtom);
    const inputBuffer = useAtomValueSafe<TermInputBuffer>(termWrap?.currentInputBufferAtom);
    const cmdBlocks = useAtomValueSafe<CmdBlock[]>(termWrap?.cmdBlocksAtom) ?? [];
    const shellIntegrationStatus = useAtomValueSafe(termWrap?.shellIntegrationStatusAtom);
    const shellType = useAtomValueSafe<ShellType>(termWrap?.shellTypeAtom) ?? "unknown";
    const altScreenActive = useAtomValueSafe<boolean>(termWrap?.altScreenActiveAtom);
    const context = useAtomValue(completionModel.contextAtom);
    const recentCommands = React.useMemo(() => recentCommandsFromBlocks(cmdBlocks), [cmdBlocks]);
    const service = React.useMemo(() => {
        const listDirectory: ListDirectoryForCompletion = (path, ctx) => listDirectoryForCompletion(path, ctx);
        return new TermCompletionService([
            makeHistoryCompletionProvider(),
            makeFigStaticCompletionProvider({ runGenerator: runCompletionGenerator }),
            makePathCommandCompletionProvider(runCompletionGenerator),
            makeHelpFallbackCompletionProvider(runCompletionGenerator, figSpecExists),
            makeFileCompletionProvider(listDirectory),
            makeAICompletionProvider(model.commandComposerBackend),
        ]);
    }, [model.commandComposerBackend]);
    const cursorPointRef = React.useRef({ x: 0, y: 0, cellHeight: 16 });
    cursorPointRef.current = getTerminalCursorMetrics(termWrap);

    const { refs, floatingStyles, update } = useFloating({
        open,
        placement: "bottom-start",
        middleware: [offset({ mainAxis: 4, crossAxis: 0 }), flip(), shift({ padding: 8 })],
    });

    React.useLayoutEffect(() => {
        if (!open) {
            return;
        }
        const virtualEl: VirtualElement = {
            getBoundingClientRect() {
                const pos = cursorPointRef.current;
                return new DOMRect(pos.x, pos.y, 0, 0);
            },
        };
        refs.setPositionReference(virtualEl);
        fireAndForget(async () => {
            await update?.();
        });
    }, [open, inputBuffer?.text, inputBuffer?.cursorIndex, items.length]);

    const lastManualRequestVersion = React.useRef(manualRequestVersion);
    React.useEffect(() => {
        const manualRequest = manualRequestVersion !== lastManualRequestVersion.current;
        lastManualRequestVersion.current = manualRequestVersion;
        if (termWrap == null || inputBuffer == null || shellIntegrationStatus !== "ready" || altScreenActive) {
            completionModel.dismiss();
            return;
        }
        if (!manualRequest && inputBuffer.text.trim() === "") {
            completionModel.dismiss();
            return;
        }
        const connection = (blockData?.meta?.connection as string) || "";
        const ctx = buildCompletionContext(inputBuffer, {
            cwd: (blockData?.meta?.["cmd:cwd"] as string) || "~",
            connId: connection === "local" ? "" : connection,
            shellType,
            env: {},
            recentCommands,
            requestKind: manualRequest ? "manual" : "auto",
        });
        const timeout = window.setTimeout(
            () => fireAndForget(() => completionModel.requestCompletions(service, ctx)),
            manualRequest ? 0 : CompletionDebounceMs
        );
        return () => window.clearTimeout(timeout);
    }, [
        altScreenActive,
        blockData?.meta,
        completionModel,
        inputBuffer?.cursorIndex,
        inputBuffer?.text,
        manualRequestVersion,
        recentCommands,
        service,
        shellIntegrationStatus,
        shellType,
        termWrap,
    ]);

    if (!open || items.length === 0) {
        return null;
    }
    const selectedItem = items[selectedIndex];
    const ghostText = selectedItem && context ? makeCompletionGhostText(context.searchTerm, selectedItem) : "";

    return (
        <FloatingPortal>
            {ghostText && (
                <div
                    className="pointer-events-none fixed z-40 select-none font-mono text-xs text-secondary opacity-45"
                    style={{
                        left: cursorPointRef.current.x,
                        top: cursorPointRef.current.y - cursorPointRef.current.cellHeight,
                    }}
                >
                    {ghostText}
                </div>
            )}
            <div
                ref={refs.setFloating}
                style={{
                    ...floatingStyles,
                    background: "var(--modal-bg-color)",
                }}
                className="z-50 w-[min(480px,calc(100vw-24px))] overflow-hidden rounded-lg border border-border text-primary shadow-2xl"
                onMouseDown={(e) => e.preventDefault()}
            >
                <div className="max-h-72 overflow-y-auto py-1">
                    {items.map((item, idx) => {
                        const selected = idx === selectedIndex;
                        return (
                            <div
                                key={`${item.source ?? "completion"}:${item.kind}:${item.insertText}:${idx}`}
                                className={[
                                    "grid min-h-8 cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 px-2 text-xs",
                                    selected ? "bg-accent/80 text-primary" : "text-secondary hover:bg-accent/20",
                                ].join(" ")}
                                onMouseEnter={() => globalStore.set(completionModel.selectedIndexAtom, idx)}
                                onClick={() => model.acceptCompletionSelected()}
                            >
                                <i className={itemIconClass(item.kind)} aria-hidden="true" />
                                <div className="min-w-0 truncate font-mono">{item.label}</div>
                                {item.detail && <div className="max-w-44 truncate opacity-75">{item.detail}</div>}
                            </div>
                        );
                    })}
                </div>
            </div>
        </FloatingPortal>
    );
}
