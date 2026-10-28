// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import ClaudeColorSvg from "@/app/asset/claude-color.svg";
import { SubBlock } from "@/app/block/block";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import { NullErrorBoundary } from "@/app/element/errorboundary";
import { Search, useSearch } from "@/app/element/search";
import { OnboardingAnchor } from "@/app/onboarding/onboarding-events";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { getLocalHomeDir } from "@/app/store/localhome";
import { useTabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atoms, getApi, getOverrideConfigAtom, getSettingsKeyAtom, WOS } from "@/store/global";
import { formatCwdLabel } from "@/util/pathlabel";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget, isLocalConnName, useAtomValueSafe } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import { ISearchOptions } from "@xterm/addon-search";
import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import { useDrop } from "react-dnd";
import { formatCmdBlockDuration, getCmdBlockStatus, getCommandRunBlockedReason } from "./cmdblockdisplay";
import { blockHasCommand, getBlockOutputText, isCmdBlockCommandPlaceholder, type CmdBlock } from "./cmdblocks";
import { describeCommandAiProblem, getBlockAiTask, type CommandInlineAIAction } from "./command-composer";
import { RiskBadge, TermCommandComposer } from "./command-composer-ui";
import { CommandLibraryPanel } from "./command-library-ui";
import { TermCompletion } from "./completion/completion-ui";
import type { ShellType } from "./completion/types";
import { TermOutputInspector } from "./output-inspector-ui";
import { TermLinkTooltip } from "./term-tooltip";
import { formatDraggedFileTerminalPaste } from "./terminal-drop";
import {
    getTerminalPresentationClassName,
    normalizeTerminalPresentationMode,
    shouldShowSemanticTerminal,
    type TerminalPresentationMode,
} from "./terminaldisplay";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import {
    computeTheme,
    normalizeCursorStyle,
    resolveTermMinimumContrastRatio,
    resolveTermScrollback,
    shouldUseWebGlRenderer,
} from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

const dlog = debug("wave:term");

interface TerminalViewProps {
    blockId: string;
    model: TermViewModel;
}

const TermClaudeIcon = React.memo(() => {
    return (
        <div className="[&_svg]:w-[15px] [&_svg]:h-[15px]" aria-hidden="true">
            <ClaudeColorSvg />
        </div>
    );
});

TermClaudeIcon.displayName = "TermClaudeIcon";

const TerminalPresentationShell = React.memo(
    ({ presentationMode, children }: { presentationMode: TerminalPresentationMode; children: React.ReactNode }) => {
        return (
            <div
                className={clsx("term-presentation-shell", getTerminalPresentationClassName(presentationMode))}
                data-terminal-presentation={presentationMode}
            >
                {children}
            </div>
        );
    }
);

TerminalPresentationShell.displayName = "TerminalPresentationShell";

const TermResyncHandler = React.memo(({ model }: TerminalViewProps) => {
    const connStatus = jotai.useAtomValue(model.connStatus);

    React.useEffect(() => {
        model.handleConnStatusChange(connStatus);
    }, [connStatus, model]);

    return null;
});

const TermVDomToolbarNode = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribeSingle({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (_event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomtoolbarblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const vdomNodeModel: BlockNodeModel = React.useMemo(
        () => ({
            blockId: vdomBlockId,
            isFocused: jotai.atom(false),
            isMagnified: jotai.atom(false),
            focusNode: () => {},
            toggleMagnify: () => {},
            onClose: () => {
                if (vdomBlockId != null) {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
                }
            },
        }),
        [vdomBlockId]
    );
    const toolbarTarget = jotai.useAtomValue(model.vdomToolbarTarget);
    const heightStr = toolbarTarget?.height ?? "1.5em";
    return (
        <div key="vdomToolbar" className="term-toolbar" style={{ height: heightStr }}>
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNodeSingleId = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribeSingle({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (_event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const vdomNodeModel: BlockNodeModel = React.useMemo(() => {
        const isFocusedAtom = jotai.atom((get) => {
            return get(model.nodeModel.isFocused) && get(model.termMode) == "vdom";
        });
        return {
            blockId: vdomBlockId,
            isFocused: isFocusedAtom,
            isMagnified: jotai.atom(false),
            focusNode: () => {
                model.nodeModel.focusNode();
            },
            toggleMagnify: () => {},
            onClose: () => {
                if (vdomBlockId != null) {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
                }
            },
        };
    }, [vdomBlockId, model]);
    return (
        <div key="htmlElem" className="term-htmlelem">
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomBlockId = jotai.useAtomValue(model.vdomBlockId);
    if (vdomBlockId == null) {
        return null;
    }
    return <TermVDomNodeSingleId key={vdomBlockId} vdomBlockId={vdomBlockId} blockId={blockId} model={model} />;
};

const TermToolbarVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomToolbarBlockId = jotai.useAtomValue(model.vdomToolbarBlockId);
    if (vdomToolbarBlockId == null) {
        return null;
    }
    return (
        <TermVDomToolbarNode
            key={vdomToolbarBlockId}
            vdomBlockId={vdomToolbarBlockId}
            blockId={blockId}
            model={model}
        />
    );
};

const InlineDockButtonClass =
    "inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40";

const TermInlineAIDock = React.memo(({ model, termWrap }: { model: TermViewModel; termWrap: TermWrap | null }) => {
    const inlineAIStates = jotai.useAtomValue(model.commandAi.inlineStatesAtom);
    const sheet = jotai.useAtomValue(model.commandAi.sheetAtom);
    const cmdBlocks = useAtomValueSafe<CmdBlock[]>(termWrap?.cmdBlocksAtom) ?? [];
    const shellIntegrationStatus = useAtomValueSafe(termWrap?.shellIntegrationStatusAtom);
    const altScreenActive = useAtomValueSafe<boolean>(termWrap?.altScreenActiveAtom) ?? false;
    const activeItem = React.useMemo(() => {
        for (let i = cmdBlocks.length - 1; i >= 0; i--) {
            const block = cmdBlocks[i];
            const state = inlineAIStates[block.id];
            if (state != null) {
                return { block, state };
            }
        }
        return null;
    }, [cmdBlocks, inlineAIStates]);

    const runAction = React.useCallback(
        (action: CommandInlineAIAction) => {
            if (activeItem == null) {
                return;
            }
            model.commandAi.handleInlineAction(activeItem.block, action);
        },
        [activeItem, model]
    );

    if (activeItem == null || sheet != null) {
        return null;
    }

    const { state } = activeItem;
    const proposal = state.proposal;
    const problem = state.status === "error" && state.result != null ? describeCommandAiProblem(state.result) : null;
    const runBlockedReason =
        proposal == null || termWrap == null
            ? "The terminal isn't ready"
            : getCommandRunBlockedReason(proposal.command, { shellIntegrationStatus, altScreenActive });
    const confirmingRun = state.confirmAction === "run";

    return (
        <div className="term-inline-ai-dock flex justify-center px-2 pt-1 pb-2">
            <div
                role="status"
                aria-live="polite"
                aria-label="Command AI suggestion"
                className="flex w-full max-w-[720px] items-center gap-3 rounded-xl border border-white/[0.09] bg-[#232325] py-2 pr-2 pl-3.5 font-sans text-[13px] shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
            >
                <i
                    className={cn(
                        "fa-solid fa-wand-magic-sparkles shrink-0 text-[12px] text-accent",
                        state.status === "loading" && "animate-pulse"
                    )}
                    aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                    {state.status === "loading" && (
                        <div className="truncate text-[12.5px] text-secondary">
                            Turning “{state.prompt}” into a command…
                        </div>
                    )}
                    {state.status === "ready" && proposal != null && (
                        <>
                            <div className="flex min-w-0 items-center gap-2">
                                <code
                                    className="min-w-0 truncate font-mono text-[12.5px] text-primary"
                                    title={proposal.command}
                                >
                                    {proposal.command}
                                </code>
                                <RiskBadge risk={proposal.risk} hiddenChars={proposal.hiddenChars} />
                            </div>
                            {proposal.explanation && (
                                <div className="truncate text-[11.5px] text-muted">{proposal.explanation}</div>
                            )}
                        </>
                    )}
                    {state.status === "error" && (
                        <div className="truncate text-[12.5px] text-secondary">
                            {problem?.title ?? "No command came back"}
                            {problem?.detail ? <span className="text-muted"> · {problem.detail}</span> : null}
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    {state.status === "ready" && proposal != null && (
                        <>
                            <button
                                type="button"
                                className={cn(InlineDockButtonClass, "bg-accent/80 text-primary hover:bg-accent")}
                                onClick={() => runAction("insert")}
                            >
                                Insert
                            </button>
                            <button
                                type="button"
                                title={
                                    runBlockedReason ?? (confirmingRun ? "Run this command anyway" : "Run this command")
                                }
                                disabled={runBlockedReason != null}
                                className={cn(
                                    InlineDockButtonClass,
                                    confirmingRun
                                        ? "bg-error/80 text-primary hover:bg-error"
                                        : "bg-white/[0.06] text-secondary hover:bg-white/[0.1] hover:text-primary"
                                )}
                                onClick={() => runAction("run")}
                            >
                                {confirmingRun ? "Run Anyway" : "Run"}
                            </button>
                        </>
                    )}
                    {state.status === "error" && (
                        <button
                            type="button"
                            className={cn(
                                InlineDockButtonClass,
                                "bg-white/[0.06] text-secondary hover:bg-white/[0.1] hover:text-primary"
                            )}
                            onClick={() => runAction("open")}
                        >
                            Open Command AI
                        </button>
                    )}
                    <button
                        type="button"
                        title="Dismiss"
                        aria-label="Dismiss AI suggestion"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.08] hover:text-primary cursor-pointer"
                        onClick={() => runAction("dismiss")}
                    >
                        <i className="fa-solid fa-xmark text-[12px]" aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
});

TermInlineAIDock.displayName = "TermInlineAIDock";

function shortConnName(connName: string): string {
    const at = connName.lastIndexOf("@");
    return at >= 0 ? connName.slice(at + 1) : connName;
}

const TermForwardDock = React.memo(({ model }: { model: TermViewModel }) => {
    const offer = jotai.useAtomValue(model.forward.offerAtom);
    if (offer == null) {
        return null;
    }
    const host = shortConnName(offer.connName);
    const forwarded = offer.status === "forwarded";
    const address = `localhost:${forwarded && offer.localPort ? offer.localPort : offer.url.port}`;
    let detail = `on ${host}`;
    if (forwarded) {
        detail =
            offer.localPort === offer.url.port ? `forwarded from ${host}` : `forwarded from ${host}:${offer.url.port}`;
    } else if (offer.status === "error") {
        detail = offer.error;
    }
    return (
        <div className="term-forward-dock flex justify-center px-2 pt-1 pb-2">
            <div
                role="status"
                aria-live="polite"
                aria-label="Open a remote port"
                className="animate-guide-in flex w-full max-w-[720px] items-center gap-3 rounded-xl border border-white/[0.09] bg-[#232325] py-2 pr-2 pl-3.5 font-sans text-[13px] shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
                onMouseEnter={() => model.forward.holdHide()}
                onMouseLeave={() => model.forward.resumeHide()}
            >
                <i
                    className={cn(
                        "shrink-0 text-[12px]",
                        offer.status === "error"
                            ? "fa-solid fa-triangle-exclamation text-error"
                            : forwarded
                              ? "fa-solid fa-circle-check text-success"
                              : "fa-solid fa-globe text-accent",
                        offer.status === "busy" && "animate-pulse"
                    )}
                    aria-hidden="true"
                />
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <code className="shrink-0 font-mono text-[12.5px] text-primary">{address}</code>
                    <span className="min-w-0 truncate text-[12px] text-muted" title={detail}>
                        {detail}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <button
                        type="button"
                        disabled={offer.status === "busy"}
                        className={cn(
                            InlineDockButtonClass,
                            offer.status === "offer" || offer.status === "busy"
                                ? "bg-accent/80 text-primary hover:bg-accent"
                                : "bg-white/[0.06] text-secondary hover:bg-white/[0.1] hover:text-primary"
                        )}
                        onClick={() => fireAndForget(() => model.forward.open())}
                    >
                        {offer.status === "busy"
                            ? "Opening…"
                            : offer.status === "error"
                              ? "Try Again"
                              : forwarded
                                ? "Open"
                                : "Open in Browser"}
                    </button>
                    <button
                        type="button"
                        title="Dismiss"
                        aria-label="Dismiss"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.08] hover:text-primary cursor-pointer"
                        onClick={() => model.forward.dismiss()}
                    >
                        <i className="fa-solid fa-xmark text-[12px]" aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
});

TermForwardDock.displayName = "TermForwardDock";

const TermCommandActionBar = React.memo(({ model, termWrap }: { model: TermViewModel; termWrap: TermWrap | null }) => {
    const cmdBlocks = useAtomValueSafe<CmdBlock[]>(termWrap?.cmdBlocksAtom) ?? [];
    const hoveredBlockId = useAtomValueSafe<number | null>(termWrap?.hoveredBlockIdAtom);
    const activeBlock = React.useMemo(() => {
        if (hoveredBlockId != null) {
            const hovered = cmdBlocks.find((block) => block.id === hoveredBlockId);
            if (blockHasCommand(hovered)) {
                return hovered;
            }
        }
        for (let i = cmdBlocks.length - 1; i >= 0; i--) {
            const block = cmdBlocks[i];
            if (blockHasCommand(block)) {
                return block;
            }
        }
        return null;
    }, [cmdBlocks, hoveredBlockId]);

    const shellIntegrationStatus = useAtomValueSafe(termWrap?.shellIntegrationStatusAtom);
    const altScreenActive = useAtomValueSafe<boolean>(termWrap?.altScreenActiveAtom) ?? false;
    const [copyFeedback, setCopyFeedback] = React.useState<string | null>(null);
    const [nowTs, setNowTs] = React.useState(Date.now());
    const status = activeBlock != null ? getCmdBlockStatus(activeBlock) : null;
    const duration = activeBlock != null ? formatCmdBlockDuration(activeBlock, nowTs) : "";
    const commandAiEnabled = jotai.useAtomValue(model.commandAiEnabledAtom);
    const aiTask = commandAiEnabled && activeBlock != null ? getBlockAiTask(activeBlock) : null;

    React.useEffect(() => {
        if (activeBlock?.state !== "running") {
            return;
        }
        setNowTs(Date.now());
        const intervalId = window.setInterval(() => setNowTs(Date.now()), 1000);
        return () => window.clearInterval(intervalId);
    }, [activeBlock?.id, activeBlock?.state]);

    const copyText = React.useCallback((text: string, label: string) => {
        if (!text) {
            return;
        }
        fireAndForget(async () => {
            await navigator.clipboard?.writeText(text);
            setCopyFeedback(label);
            window.setTimeout(() => setCopyFeedback(null), 1200);
        });
    }, []);

    const copyCommand = React.useCallback(() => {
        if (isCmdBlockCommandPlaceholder(activeBlock?.command)) {
            return;
        }
        copyText(activeBlock?.command ?? "", "Copied command");
    }, [activeBlock?.command, copyText]);

    const copyOutput = React.useCallback(() => {
        if (activeBlock == null || termWrap == null) {
            return;
        }
        copyText(getBlockOutputText(activeBlock, termWrap.terminal), "Copied output");
    }, [activeBlock, copyText, termWrap]);

    const rerunCommand = React.useCallback(() => {
        if (!activeBlock?.command || termWrap == null) {
            return;
        }
        termWrap.runCommand(activeBlock.command);
    }, [activeBlock?.command, termWrap]);

    const jumpPastOutput = React.useCallback(() => {
        model.jumpPastOutput();
    }, [model]);

    const askCommandAi = React.useCallback(() => {
        if (activeBlock == null) {
            return;
        }
        model.commandAi.open({ block: activeBlock, submit: true });
    }, [activeBlock, model]);

    const preventButtonFocus = React.useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
    }, []);

    if (activeBlock == null || status == null) {
        return null;
    }

    const canCopyOutput = activeBlock.state === "done" && termWrap != null;
    const commandIsPlaceholder = isCmdBlockCommandPlaceholder(activeBlock.command);
    const rerunBlockedReason =
        termWrap == null
            ? "Terminal is not ready"
            : getCommandRunBlockedReason(activeBlock.command, { shellIntegrationStatus, altScreenActive });

    return (
        <div
            className={`term-command-action-bar is-${status.tone}`}
            aria-label="Command actions"
            data-onboarding={OnboardingAnchor.CommandActionBar}
        >
            <div className="term-command-action-status" title={status.label}>
                <i className={status.iconClass} aria-hidden="true" />
            </div>
            <div className="term-command-action-main" title={activeBlock.command ?? ""}>
                <div className="term-command-action-command">{activeBlock.command}</div>
                <div className="term-command-action-meta">
                    <span>{status.label}</span>
                    <span>{duration}</span>
                    {copyFeedback && <span>{copyFeedback}</span>}
                </div>
            </div>
            <div className="term-command-action-buttons">
                <button
                    type="button"
                    className="term-command-action-btn cursor-pointer"
                    title={commandIsPlaceholder ? "This command was too large to record" : "Copy command"}
                    aria-label="Copy command"
                    onMouseDown={preventButtonFocus}
                    onClick={copyCommand}
                    disabled={commandIsPlaceholder}
                >
                    <i className="fa-solid fa-terminal" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="term-command-action-btn cursor-pointer"
                    title="Copy output"
                    aria-label="Copy output"
                    onMouseDown={preventButtonFocus}
                    onClick={copyOutput}
                    disabled={!canCopyOutput}
                >
                    <i className="fa-solid fa-copy" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="term-command-action-btn cursor-pointer"
                    title="Inspect output"
                    aria-label="Inspect output"
                    onMouseDown={preventButtonFocus}
                    onClick={() => model.inspectCommandOutput(activeBlock)}
                    disabled={termWrap == null || altScreenActive}
                >
                    <i className="fa-solid fa-file-lines" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="term-command-action-btn cursor-pointer"
                    title={rerunBlockedReason ?? "Re-run command"}
                    aria-label="Re-run command"
                    onMouseDown={preventButtonFocus}
                    onClick={rerunCommand}
                    disabled={rerunBlockedReason != null}
                >
                    <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="term-command-action-btn cursor-pointer"
                    title="Jump past output"
                    aria-label="Jump past output"
                    onMouseDown={preventButtonFocus}
                    onClick={jumpPastOutput}
                >
                    <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                </button>
                {aiTask != null && (
                    <button
                        type="button"
                        className="term-command-action-btn cursor-pointer"
                        title={aiTask === "fix" ? "Fix with AI" : "Explain with AI"}
                        data-onboarding={OnboardingAnchor.BlockAiButton}
                        aria-label={aiTask === "fix" ? "Fix with AI" : "Explain with AI"}
                        onMouseDown={preventButtonFocus}
                        onClick={askCommandAi}
                    >
                        <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
});

TermCommandActionBar.displayName = "TermCommandActionBar";

const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [termWrapInst, setTermWrapInst] = React.useState<TermWrap | null>(null);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const connStatus = jotai.useAtomValue(model.connStatus);
    const shellIntegrationStatus = useAtomValueSafe(termWrapInst?.shellIntegrationStatusAtom);
    const integrationDisabled = useAtomValueSafe<boolean>(termWrapInst?.shellIntegrationDisabledAtom) ?? false;
    const shellType = useAtomValueSafe<ShellType>(termWrapInst?.shellTypeAtom) ?? "unknown";
    const commandAiContextLabel = React.useMemo(() => {
        const connName = blockData?.meta?.connection;
        const cwd = blockData?.meta?.["cmd:cwd"];
        return [
            connName && !isLocalConnName(connName) ? connName : "This computer",
            shellType !== "unknown" ? shellType : null,
            cwd ? formatCwdLabel(cwd, connName && !isLocalConnName(connName) ? null : getLocalHomeDir()) : null,
        ]
            .filter(Boolean)
            .join(" · ");
    }, [blockData?.meta?.connection, blockData?.meta?.["cmd:cwd"], shellType]);
    React.useEffect(() => {
        globalStore.set(model.shellStatusInputsAtom, {
            report: { integrationDisabled, shellType },
            integrationReported: shellIntegrationStatus != null,
            missingIntegrationSince: termWrapInst != null && shellIntegrationStatus == null ? Date.now() : undefined,
        });
        return () => globalStore.set(model.shellStatusInputsAtom, {});
    }, [model, termWrapInst, shellIntegrationStatus, integrationDisabled, shellType]);
    const lastCommand = useAtomValueSafe(termWrapInst?.lastCommandAtom);
    const settingsScrollback = jotai.useAtomValue(getSettingsKeyAtom("term:scrollback"));
    const settingsFontFamily = jotai.useAtomValue(getSettingsKeyAtom("term:fontfamily"));
    const settingsDisableWebGl = jotai.useAtomValue(getSettingsKeyAtom("term:disablewebgl"));
    const macOptionIsMeta = jotai.useAtomValue(getOverrideConfigAtom(blockId, "term:macoptionismeta"));
    const terminalPresentationSetting = jotai.useAtomValue(getOverrideConfigAtom(blockId, "term:presentation"));
    const terminalPresentationMode = normalizeTerminalPresentationMode(terminalPresentationSetting);
    // Command blocks (Warp-style) are drawn as xterm decorations over the live terminal,
    // managed in TermWrap; in semantic mode each finished command gets a card behind its
    // text. Enable/disable the decorations when the presentation mode changes.
    React.useEffect(() => {
        termWrapInst?.setSemanticBlocksEnabled(terminalPresentationMode === "semantic");
    }, [termWrapInst, terminalPresentationMode]);
    let termMode = blockData?.meta?.["term:mode"] ?? "term";
    if (termMode != "term" && termMode != "vdom") {
        termMode = "term";
    }
    const termModeRef = React.useRef(termMode);

    const tabModel = useTabModel();
    const paneActive = jotai.useAtomValue(tabModel.isActiveAtom);
    React.useEffect(() => {
        termWrapInst?.setPaneActive(paneActive);
    }, [termWrapInst, paneActive]);
    const termFontSize = jotai.useAtomValue(model.fontSizeAtom);
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const connFontFamily = fullConfig.connections?.[blockData?.meta?.connection]?.["term:fontfamily"];
    const termFontFamily = settingsFontFamily ?? connFontFamily ?? "Hack";
    const termScrollback = resolveTermScrollback(settingsScrollback, blockData?.meta?.["term:scrollback"]);
    const isFocused = jotai.useAtomValue(model.nodeModel.isFocused);
    const isMI = jotai.useAtomValue(tabModel.isTermMultiInput);
    const isBasicTerm = termMode != "vdom" && blockData?.meta?.controller != "cmd"; // needs to match isBasicTerm

    // search
    const searchProps = useSearch({
        anchorRef: viewRef,
        viewModel: model,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
    });
    const searchIsOpen = jotai.useAtomValue<boolean>(searchProps.isOpen);
    const caseSensitive = useAtomValueSafe<boolean>(searchProps.caseSensitive);
    const wholeWord = useAtomValueSafe<boolean>(searchProps.wholeWord);
    const regex = useAtomValueSafe<boolean>(searchProps.regex);
    const searchVal = jotai.useAtomValue<string>(searchProps.searchValue);
    const searchDecorations = React.useMemo(
        () => ({
            matchOverviewRuler: "#000000",
            activeMatchColorOverviewRuler: "#000000",
            activeMatchBorder: "#FF9632",
            matchBorder: "#FFFF00",
        }),
        []
    );
    const searchOpts = React.useMemo<ISearchOptions>(
        () => ({
            regex,
            wholeWord,
            caseSensitive,
            decorations: searchDecorations,
        }),
        [regex, wholeWord, caseSensitive]
    );
    const handleSearchError = React.useCallback((e: Error) => {
        console.warn("search error:", e);
    }, []);
    const executeSearch = React.useCallback(
        (searchText: string, direction: "next" | "previous") => {
            model.termRef.current?.search(searchText, direction, searchOpts).catch(handleSearchError);
        },
        [searchOpts, handleSearchError]
    );
    searchProps.onSearch = React.useCallback(
        (searchText: string) => executeSearch(searchText, "previous"),
        [executeSearch]
    );
    searchProps.onPrev = React.useCallback(() => executeSearch(searchVal, "previous"), [executeSearch, searchVal]);
    searchProps.onNext = React.useCallback(() => executeSearch(searchVal, "next"), [executeSearch, searchVal]);
    // Return input focus to the terminal when the search is closed
    React.useEffect(() => {
        if (!searchIsOpen) {
            model.termRef.current?.clearSearch();
            model.giveFocus();
        }
    }, [searchIsOpen]);
    // rerun search when the searchOpts change
    React.useEffect(() => {
        model.termRef.current?.clearSearch();
        searchProps.onSearch(searchVal);
    }, [searchOpts]);
    // end search

    // Rebuilding disposes the terminal and replays its whole history, so only a new block
    // does that; option changes (font, scrollback, renderer) are applied live below.
    React.useEffect(() => {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemeName = globalStore.get(model.termThemeNameAtom);
        const termTransparency = globalStore.get(model.termTransparencyAtom);
        const termMacOptionIsMetaAtom = getOverrideConfigAtom(blockId, "term:macoptionismeta");
        const [termTheme, _] = computeTheme(fullConfig, termThemeName, termTransparency);
        const termAllowBPM = globalStore.get(model.termBPMAtom) ?? true;
        const termMacOptionIsMeta = globalStore.get(termMacOptionIsMetaAtom) ?? false;
        const termCursorStyle = normalizeCursorStyle(globalStore.get(getOverrideConfigAtom(blockId, "term:cursor")));
        const termCursorBlink = globalStore.get(getOverrideConfigAtom(blockId, "term:cursorblink")) ?? false;
        const wasFocused = model.termRef.current != null && globalStore.get(model.nodeModel.isFocused);
        const termWrap = new TermWrap(
            tabModel.tabId,
            blockId,
            connectElemRef.current,
            {
                theme: termTheme,
                fontSize: termFontSize,
                fontFamily: termFontFamily,
                drawBoldTextInBrightColors: false,
                fontWeight: "normal",
                fontWeightBold: "bold",
                minimumContrastRatio: resolveTermMinimumContrastRatio(termTheme),
                allowTransparency: true,
                scrollback: termScrollback,
                allowProposedApi: true, // Required by @xterm/addon-search to enable search functionality and decorations
                ignoreBracketedPasteMode: !termAllowBPM,
                macOptionIsMeta: termMacOptionIsMeta,
                cursorStyle: termCursorStyle,
                cursorBlink: termCursorBlink,
                overviewRuler: { width: 6 },
            },
            {
                keydownHandler: model.handleTerminalKeydown.bind(model),
                useWebGl: shouldUseWebGlRenderer(settingsDisableWebGl, termTheme),
                sendDataHandler: model.sendDataToController.bind(model),
                onInlineAIRequest: model.openInlineCommandAI.bind(model),
                onInlineAIDismiss: model.dismissInlineCommandAI.bind(model),
                nodeModel: model.nodeModel,
            }
        );
        (window as any).term = termWrap;
        termWrap.setPaneActive(globalStore.get(tabModel.isActiveAtom));
        model.termRef.current = termWrap;
        setTermWrapInst(termWrap);
        const rszObs = new ResizeObserver(() => {
            termWrap.handleResize_debounced();
        });
        rszObs.observe(connectElemRef.current);
        termWrap.onLocalUrls = (urls) => model.forward.noteUrls(urls);
        termWrap.onOpenLink = (uri) => model.forward.openLink(uri);
        termWrap.onSearchResultsDidChange = (results) => {
            globalStore.set(searchProps.resultsIndex, results.resultIndex);
            globalStore.set(searchProps.resultsCount, results.resultCount);
        };
        const unsubCmdBlocks = globalStore.sub(termWrap.cmdBlocksAtom, () =>
            model.noteCmdBlocks(globalStore.get(termWrap.cmdBlocksAtom))
        );
        fireAndForget(termWrap.initTerminal.bind(termWrap));
        if (wasFocused) {
            setTimeout(() => {
                model.giveFocus();
            }, 10);
        }
        return () => {
            unsubCmdBlocks();
            termWrap.dispose();
            rszObs.disconnect();
            setTermWrapInst(null);
        };
    }, [blockId]);

    React.useEffect(() => {
        termWrapInst?.setFontOptions(termFontSize, termFontFamily);
    }, [termWrapInst, termFontSize, termFontFamily]);

    React.useEffect(() => {
        termWrapInst?.setScrollback(termScrollback);
    }, [termWrapInst, termScrollback]);

    React.useEffect(() => {
        if (termWrapInst == null) {
            return;
        }
        termWrapInst.terminal.options.macOptionIsMeta = macOptionIsMeta ?? false;
    }, [termWrapInst, macOptionIsMeta]);

    React.useEffect(() => {
        termWrapInst?.setTermRenderer(shouldUseWebGlRenderer(settingsDisableWebGl) ? "webgl" : "dom");
    }, [termWrapInst, settingsDisableWebGl]);

    React.useEffect(() => {
        if (termModeRef.current == "vdom" && termMode == "term") {
            // focus the terminal
            model.giveFocus();
        }
        termModeRef.current = termMode;
    }, [termMode]);

    React.useEffect(() => {
        if (paneActive && isMI && isBasicTerm && isFocused && model.termRef.current != null) {
            model.termRef.current.multiInputCallback = (data: string) => {
                model.multiInputHandler(data);
            };
        } else {
            if (model.termRef.current != null) {
                model.termRef.current.multiInputCallback = null;
            }
        }
    }, [paneActive, isMI, isBasicTerm, isFocused, termWrapInst]);

    const stickerConfig = {
        charWidth: 8,
        charHeight: 16,
        rows: model.termRef.current?.terminal.rows ?? 24,
        cols: model.termRef.current?.terminal.cols ?? 80,
        blockId: blockId,
    };

    const termBg = computeBgStyleFromMeta(blockData?.meta);

    const handleContextMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const rightClickPaste = globalStore.get(getSettingsKeyAtom("app:rightclickpaste"));
            if (rightClickPaste && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                getApi().nativePaste();
                model.giveFocus();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const menuItems = model.getContextMenuItems();
            ContextMenuModel.getInstance().showContextMenu(menuItems, e);
        },
        [model]
    );

    const handleDraggedFileDrop = React.useCallback(
        (draggedFile: DraggedFile) => {
            const pasteText = formatDraggedFileTerminalPaste(draggedFile, {
                terminalConnection: connStatus?.connection ?? blockData?.meta?.connection ?? "local",
                terminalShellIntegrationStatus: shellIntegrationStatus,
                terminalLastCommand: lastCommand,
                terminalShellType: shellType,
            });
            if (!pasteText) {
                return;
            }
            model.termRef.current?.terminal?.paste(pasteText);
            model.giveFocus();
        },
        [blockData?.meta?.connection, connStatus?.connection, lastCommand, model, shellIntegrationStatus, shellType]
    );

    const [, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM",
            drop: (draggedFile: DraggedFile, monitor) => {
                if (monitor.didDrop()) {
                    return;
                }
                handleDraggedFileDrop(draggedFile);
            },
        }),
        [handleDraggedFileDrop]
    );

    const viewDropRef = React.useCallback(
        (node: HTMLDivElement | null) => {
            viewRef.current = node;
            drop(node);
        },
        [drop]
    );

    return (
        <div
            className={clsx(
                "view-term",
                "term-mode-" + termMode,
                getTerminalPresentationClassName(terminalPresentationMode)
            )}
            ref={viewDropRef}
            onContextMenu={handleContextMenu}
        >
            {termBg && <div key="term-bg" className="absolute inset-0 z-0 pointer-events-none" style={termBg} />}
            <TermResyncHandler blockId={blockId} model={model} />
            <TermThemeUpdater blockId={blockId} model={model} termRef={model.termRef} />
            <TermStickers config={stickerConfig} />
            <TermToolbarVDomNode key="vdom-toolbar" blockId={blockId} model={model} />
            <TermVDomNode key="vdom" blockId={blockId} model={model} />
            {shouldShowSemanticTerminal(terminalPresentationMode) && (
                <TermCommandActionBar model={model} termWrap={termWrapInst} />
            )}
            <TerminalPresentationShell presentationMode={terminalPresentationMode}>
                <div key="connect-elem" className="term-connectelem" ref={connectElemRef} />
            </TerminalPresentationShell>
            <TermOutputInspector model={model} />
            <CommandLibraryPanel
                context={model.getCommandLibraryContext()}
                onInsert={(command) => model.insertLibraryCommand(command)}
                onJump={(entry) => model.openHistoryCommand(entry)}
                hasOutput={(entry) => model.hasHistoryOutput(entry)}
                onClose={() => {
                    if (globalStore.get(model.nodeModel.isFocused) && document.hasFocus()) {
                        model.giveFocus();
                    }
                }}
            />
            <TermForwardDock model={model} />
            <TermInlineAIDock model={model} termWrap={termWrapInst} />
            <TermCompletion model={model} blockData={blockData} termWrap={termWrapInst} />
            <NullErrorBoundary debugName="TermLinkTooltip">
                <TermLinkTooltip termWrap={termWrapInst} />
            </NullErrorBoundary>
            <TermCommandComposer
                model={model}
                termWrap={termWrapInst}
                contextLabel={commandAiContextLabel}
                isMac={isMacOS()}
            />
            <Search {...searchProps} />
        </div>
    );
};

export { TermClaudeIcon, TerminalView };
