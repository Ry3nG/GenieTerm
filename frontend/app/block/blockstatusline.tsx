// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { cn, useAtomValueSafe } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import type { BlockEnv } from "./blockenv";
import { getBlockStatus, type BlockStatus, type BlockStatusActionId } from "./blockstatus";

function useNowWhile(active: boolean, deadline?: number): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (!active && deadline == null) {
            return;
        }
        setNow(Date.now());
        const interval = active ? setInterval(() => setNow(Date.now()), 1000) : null;
        const timer = deadline > Date.now() ? setTimeout(() => setNow(Date.now()), deadline - Date.now()) : null;
        return () => {
            clearInterval(interval);
            clearTimeout(timer);
        };
    }, [active, deadline]);
    return now;
}

export function BlockStatusLineContent({
    status,
    onAction,
}: {
    status: BlockStatus;
    onAction: (action: BlockStatusActionId) => Promise<void>;
}) {
    const [busy, setBusy] = React.useState<BlockStatusActionId>(null);
    const [failure, setFailure] = React.useState<{ message: string; action: BlockStatusActionId }>(null);
    const pending = React.useRef(false);
    const [operationStatus, setOperationStatus] = React.useState<BlockStatus>(null);
    const visibleStatus = busy != null || failure != null ? operationStatus : status;
    const run = async (action: BlockStatusActionId) => {
        if (pending.current) {
            return;
        }
        pending.current = true;
        setOperationStatus(visibleStatus);
        setBusy(action);
        setFailure(null);
        try {
            await onAction(action);
        } catch (error) {
            setFailure({ message: String(error), action });
        } finally {
            pending.current = false;
            setBusy(null);
        }
    };
    if (visibleStatus == null) {
        return null;
    }
    const severity = failure != null ? "error" : visibleStatus.severity;
    const actions = failure != null ? [{ id: failure.action, label: "Retry", primary: true }] : visibleStatus.actions;
    const color = severity == "progress" ? undefined : `var(--${severity == "info" ? "accent" : severity}-color)`;
    return (
        <div
            className="@container/status w-full shrink-0 border-b border-border bg-panel"
            data-block-status={visibleStatus.kind}
        >
            <div className="flex min-h-8 items-start gap-2 px-2.5 py-1.5 text-[12px] leading-4 @max-[360px]/status:flex-wrap">
                <i
                    aria-hidden="true"
                    className={cn(
                        "fa-solid mt-px shrink-0 text-[13px]",
                        severity == "progress"
                            ? "fa-circle-notch fa-spin text-muted"
                            : severity == "info"
                              ? "fa-circle-info"
                              : "fa-triangle-exclamation"
                    )}
                    style={{ color }}
                />
                {/* the detail gets its own line rather than being cut off after the title */}
                <div
                    role="status"
                    aria-live="polite"
                    className="min-w-0 flex-1 self-center"
                    title={
                        failure?.message ??
                        [visibleStatus.title, visibleStatus.detail, visibleStatus.tooltip].filter(Boolean).join(" — ")
                    }
                >
                    <div className={cn("line-clamp-2 break-words text-primary", failure != null && "text-error")}>
                        {failure?.message ?? visibleStatus.title}
                    </div>
                    {failure == null && visibleStatus.detail && (
                        <div className="line-clamp-2 break-words text-[11px] text-muted">{visibleStatus.detail}</div>
                    )}
                </div>
                {actions.length > 0 && (
                    <div className="flex shrink-0 flex-wrap items-center gap-1 self-center @max-[360px]/status:order-last @max-[360px]/status:w-full @max-[360px]/status:pl-[21px]">
                        {actions.map((action) => (
                            <button
                                key={action.id}
                                type="button"
                                title={action.title}
                                disabled={busy != null}
                                aria-busy={busy == action.id}
                                onClick={() => void run(action.id)}
                                className={cn(
                                    "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50",
                                    action.primary
                                        ? "bg-accent/80 text-primary hover:bg-accent"
                                        : "border border-border text-muted hover:text-primary hover:bg-accent/10"
                                )}
                            >
                                {busy == action.id && (
                                    <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                                )}
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
                {failure == null && visibleStatus.dismiss != null && (
                    <button
                        type="button"
                        aria-label="Dismiss status"
                        title="Dismiss"
                        disabled={busy != null}
                        onClick={() => void run(visibleStatus.dismiss)}
                        className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center self-center rounded text-muted transition-colors hover:bg-accent/10 hover:text-primary cursor-pointer disabled:opacity-50 @max-[360px]/status:self-start"
                    >
                        <i
                            aria-hidden="true"
                            className={cn(
                                "fa-solid",
                                busy == visibleStatus.dismiss ? "fa-circle-notch fa-spin" : "fa-xmark"
                            )}
                        />
                    </button>
                )}
            </div>
        </div>
    );
}

export async function runBlockStatusAction(
    action: BlockStatusActionId,
    options: {
        env: BlockEnv;
        connName: string;
        blockId: string;
        connStatus: ConnStatus;
        viewModel: ViewModel;
        dismissHelperOff: () => void;
    }
) {
    const { env, connName, blockId, connStatus, viewModel, dismissHelperOff } = options;
    switch (action) {
        case "reconnect":
        case "reconnect-stalled":
            // A stalled transport must close before a fresh connection can be opened.
            if (action == "reconnect-stalled") {
                await env.rpc.ConnDisconnectCommand(TabRpcClient, connName, { timeout: 5000 });
            }
            await env.rpc.ConnConnectCommand(TabRpcClient, { host: connName, logblockid: blockId }, { timeout: 60000 });
            return;
        case "disconnect":
            await env.rpc.ConnDisconnectCommand(TabRpcClient, connName, { timeout: 5000 });
            return;
        case "retry-helper":
            await env.rpc.ConnReinstallWshCommand(
                TabRpcClient,
                { connname: connName, logblockid: blockId },
                { timeout: 120000 }
            );
            return;
        case "disable-helper": {
            const metamaptype: unknown = { "conn:wshenabled": false };
            await env.rpc.SetConnectionsConfigCommand(TabRpcClient, {
                host: connName,
                metamaptype,
            });
            return;
        }
        case "dismiss-helper-error":
            await env.rpc.DismissWshFailCommand(TabRpcClient, connName);
            return;
        case "dismiss-helper-off":
            dismissHelperOff();
            return;
        case "copy":
            await navigator.clipboard.writeText(
                connStatus.status == "error" ? (connStatus.error ?? "") : (connStatus.wsherror ?? "")
            );
            return;
        default:
            await viewModel.handleBlockStatusAction(action);
    }
}

export function BlockStatusLine({
    blockId,
    viewModel,
    connModalOpen,
}: {
    blockId: string;
    viewModel: ViewModel;
    connModalOpen: boolean;
}) {
    const env = useWaveEnv<BlockEnv>();
    const connName = jotai.useAtomValue(env.getBlockMetaKeyAtom(blockId, "connection"));
    return (
        <ConnectedBlockStatusLine
            key={connName ?? "local"}
            blockId={blockId}
            connName={connName}
            viewModel={viewModel}
            connModalOpen={connModalOpen}
        />
    );
}

function ConnectedBlockStatusLine({
    blockId,
    connName,
    viewModel,
    connModalOpen,
}: {
    blockId: string;
    connName: string;
    viewModel: ViewModel;
    connModalOpen: boolean;
}) {
    const env = useWaveEnv<BlockEnv>();
    const connStatus = jotai.useAtomValue(env.getConnStatusAtom(connName));
    const isLayoutMode = jotai.useAtomValue(env.atoms.controlShiftDelayAtom);
    const wshConfigEnabled = jotai.useAtomValue(env.getConnConfigKeyAtom(connName, "conn:wshenabled"));
    const terminalInputs = useAtomValueSafe(viewModel.blockStatusInputsAtom);
    const [helperOffDismissed, setHelperOffDismissed] = React.useState(false);
    const now = useNowWhile(
        Boolean(connStatus?.reconnecting || connStatus?.connhealthstatus == "stalled"),
        terminalInputs?.missingIntegrationSince == null ? undefined : terminalInputs.missingIntegrationSince + 2500
    );
    const status = getBlockStatus({
        ...terminalInputs,
        connName,
        connStatus,
        isTerminal: viewModel.viewType == "term",
        now,
        wshConfigEnabled,
        helperOffDismissed,
        isLayoutMode,
        connModalOpen,
    });
    return (
        <BlockStatusLineContent
            status={status}
            onAction={(action) =>
                runBlockStatusAction(action, {
                    env,
                    connName,
                    blockId,
                    connStatus,
                    viewModel,
                    dismissHelperOff: () => setHelperOffDismissed(true),
                })
            }
        />
    );
}
