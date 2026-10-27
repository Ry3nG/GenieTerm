// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { FloatingPortal, VirtualElement, flip, offset, shift, useFloating } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import * as React from "react";
import { blockHasCommand, type CmdBlock } from "../cmdblocks";
import type { TermViewModel } from "../term-model";
import type { TermWrap } from "../termwrap";
import { TermCompletionService } from "./completion-service";
import { makeFileCompletionProvider, type ListDirectoryForCompletion } from "./file-provider";
import { makeCompletionGhostText } from "./ghost";
import { makeHelpFallbackCompletionProvider } from "./help-provider";
import { makeHistoryCompletionProvider } from "./history-provider";
import { hasFigSpec, makeLazyFigCompletionProvider } from "./lazy-fig-provider";
import { makePathCommandCompletionProvider } from "./path-provider";
import { makePowerShellParameterCompletionProvider } from "./powershell-provider";
import { buildCompletionContext } from "./tokenizer";
import type { CompletionItem, ShellName, ShellType, TermInputBuffer } from "./types";

const CompletionDebounceMs = 90;
const MaxRecentCommands = 80;
const DirectoryCompletionLimit = 200;
const ShellDirectoryListScript = [
    "dir=${GT_COMPLETION_DIR:-.}",
    'case "$dir" in',
    '  "~") dir=$HOME ;;',
    '  "~/"*) dir=$HOME/${dir#~/} ;;',
    "esac",
    '[ -d "$dir" ] || exit 0',
    "count=0",
    'for p in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do',
    '  [ -e "$p" ] || continue',
    "  name=${p##*/}",
    '  [ "$name" = "." ] && continue',
    '  [ "$name" = ".." ] && continue',
    "  type=f",
    '  [ -d "$p" ] && type=d',
    `  printf '%s\\0%s\\0%s\\0' "$type" "$name" "$p"`,
    "  count=$((count + 1))",
    '  [ "$count" -ge "$GT_COMPLETION_LIMIT" ] && break',
    "done",
].join("\n");

type CompletionGeneratorRequest = {
    command: string;
    args: string[];
    cwd: string;
    connId: string;
    env?: Record<string, string>;
    timeoutMs?: number;
};

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
    try {
        const stream = RpcApi.FileListStreamCommand(
            TabRpcClient,
            { path: remotePath, opts: { limit: DirectoryCompletionLimit } },
            null
        );
        for await (const chunk of stream) {
            if (chunk?.fileinfo) {
                entries.push(...chunk.fileinfo);
            }
        }
        return entries;
    } catch {
        return listDirectoryViaCompletionGenerator(path, ctx);
    }
}

async function listDirectoryViaCompletionGenerator(path: string, ctx: { connId: string }): Promise<FileInfo[]> {
    const rtn = await runCompletionGenerator({
        command: "sh",
        args: ["-c", ShellDirectoryListScript],
        cwd: "",
        connId: ctx.connId,
        env: {
            GT_COMPLETION_DIR: path,
            GT_COMPLETION_LIMIT: String(DirectoryCompletionLimit),
        },
        timeoutMs: 3000,
    });
    if (!rtn.supported || rtn.exitcode !== 0 || rtn.stdout === "") {
        return [];
    }
    const fields = rtn.stdout.split("\0");
    const entries: FileInfo[] = [];
    for (let idx = 0; idx + 2 < fields.length; idx += 3) {
        const type = fields[idx];
        const name = fields[idx + 1];
        const entryPath = fields[idx + 2];
        if (!name || !entryPath) {
            continue;
        }
        entries.push({ path: entryPath, dir: path, name, isdir: type === "d" });
    }
    return entries;
}

async function runCompletionGenerator(req: CompletionGeneratorRequest) {
    const rtn = await RpcApi.RunCompletionGenCommand(TabRpcClient, {
        connname: req.connId || "",
        cwd: req.cwd,
        command: req.command,
        args: req.args,
        env: req.env,
        timeoutms: req.timeoutMs,
    });
    return { stdout: rtn.stdout, exitcode: rtn.exitcode, supported: rtn.supported };
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
    const selectionExplicit = useAtomValue(completionModel.selectionExplicitAtom);
    const status = useAtomValue(completionModel.statusAtom);
    const manualRequestVersion = useAtomValue(completionModel.manualRequestVersionAtom);
    const inputBuffer = useAtomValueSafe<TermInputBuffer>(termWrap?.currentInputBufferAtom);
    const cmdBlocks = useAtomValueSafe<CmdBlock[]>(termWrap?.cmdBlocksAtom) ?? [];
    const shellIntegrationStatus = useAtomValueSafe(termWrap?.shellIntegrationStatusAtom);
    const shellType = useAtomValueSafe<ShellType>(termWrap?.shellTypeAtom) ?? "unknown";
    const shellName = useAtomValueSafe<ShellName>(termWrap?.shellNameAtom) ?? "unknown";
    const altScreenActive = useAtomValueSafe<boolean>(termWrap?.altScreenActiveAtom);
    const context = useAtomValue(completionModel.contextAtom);
    const [showLoading, setShowLoading] = React.useState(false);
    const listRef = React.useRef<HTMLDivElement>(null);
    const focused = useAtomValue(model.nodeModel.isFocused);
    const visible = focused && (open || showLoading);
    React.useEffect(() => {
        setShowLoading(false);
        if (status !== "loading" || context?.requestKind !== "manual") {
            return;
        }
        const timer = window.setTimeout(() => setShowLoading(true), 250);
        return () => window.clearTimeout(timer);
    }, [status, context]);
    React.useEffect(() => {
        if (!focused) {
            completionModel.invalidate();
        }
    }, [focused, completionModel]);
    React.useEffect(() => {
        if (selectionExplicit) {
            listRef.current?.children[selectedIndex]?.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex, selectionExplicit]);
    const recentCommands = React.useMemo(() => recentCommandsFromBlocks(cmdBlocks), [cmdBlocks]);
    const service = React.useMemo(() => {
        const listDirectory: ListDirectoryForCompletion = (path, ctx) => listDirectoryForCompletion(path, ctx);
        return new TermCompletionService([
            makeHistoryCompletionProvider(),
            makeLazyFigCompletionProvider(runCompletionGenerator),
            makePathCommandCompletionProvider(runCompletionGenerator),
            makePowerShellParameterCompletionProvider(runCompletionGenerator),
            makeHelpFallbackCompletionProvider(runCompletionGenerator, hasFigSpec),
            makeFileCompletionProvider(listDirectory),
        ]);
    }, []);
    const cursorPointRef = React.useRef({ x: 0, y: 0, cellHeight: 16 });
    cursorPointRef.current = getTerminalCursorMetrics(termWrap);

    const { refs, floatingStyles, update } = useFloating({
        open: visible,
        placement: "bottom-start",
        middleware: [offset({ mainAxis: 4, crossAxis: 0 }), flip(), shift({ padding: 8 })],
    });

    React.useLayoutEffect(() => {
        if (!visible) {
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
    }, [visible, inputBuffer?.text, inputBuffer?.cursorIndex, items.length]);

    const lastManualRequestVersion = React.useRef(manualRequestVersion);
    React.useEffect(() => {
        const manualRequest = manualRequestVersion !== lastManualRequestVersion.current;
        lastManualRequestVersion.current = manualRequestVersion;
        // anything shown or in flight was computed for the previous input
        completionModel.invalidate();
        if (
            termWrap == null ||
            !focused ||
            inputBuffer == null ||
            shellIntegrationStatus === "running-command" ||
            altScreenActive
        ) {
            return;
        }
        if (!manualRequest && inputBuffer.text.trim() === "") {
            return;
        }
        if (!manualRequest && inputBuffer.text.trim() === completionModel.suppressedAutoText?.trim()) {
            return;
        }
        const connection = (blockData?.meta?.connection as string) || "";
        const ctx = buildCompletionContext(inputBuffer, {
            cwd: (blockData?.meta?.["cmd:cwd"] as string) || "~",
            connId: connection === "local" ? "" : connection,
            shellType,
            shellName,
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
        focused,
        inputBuffer?.cursorIndex,
        inputBuffer?.text,
        manualRequestVersion,
        recentCommands,
        service,
        shellIntegrationStatus,
        shellType,
        shellName,
        termWrap,
    ]);

    if (!visible || (!showLoading && items.length === 0)) {
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
                {showLoading && status === "loading" ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-secondary" role="status">
                        <i className="fa-solid fa-circle-notch animate-spin" aria-hidden="true" />
                        Finding completions…
                    </div>
                ) : (
                    <div
                        ref={listRef}
                        className="max-h-64 overflow-y-auto py-1"
                        role="listbox"
                        aria-label="Completions"
                    >
                        {items.map((item, idx) => {
                            const selected = idx === selectedIndex;
                            return (
                                <div
                                    key={`${item.source ?? "completion"}:${item.kind}:${item.insertText}:${idx}`}
                                    role="option"
                                    aria-selected={selected && selectionExplicit}
                                    className={[
                                        "grid min-h-8 cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 px-2 text-xs",
                                        selected && selectionExplicit
                                            ? "bg-accent/80 text-primary"
                                            : "text-secondary hover:bg-accent/20",
                                    ].join(" ")}
                                    onClick={() => {
                                        completionModel.selectIndex(idx);
                                        model.acceptCompletionSelected();
                                    }}
                                >
                                    <i className={itemIconClass(item.kind)} aria-hidden="true" />
                                    <div className="min-w-0 truncate font-mono">{item.label}</div>
                                    {item.detail && <div className="max-w-44 truncate opacity-75">{item.detail}</div>}
                                </div>
                            );
                        })}
                    </div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-2.5 py-1.5 text-[10px] text-secondary">
                    <span>↑↓ Choose</span>
                    <span>{selectionExplicit ? "Tab Insert" : "Tab Shell completion"}</span>
                    {!selectionExplicit && completionModel.canAcceptWithArrowRight(inputBuffer) && (
                        <span>→ Complete</span>
                    )}
                    <span className="ml-auto">Esc Dismiss</span>
                </div>
            </div>
        </FloatingPortal>
    );
}
