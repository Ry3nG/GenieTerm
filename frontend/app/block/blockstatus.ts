// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getShellIntegrationRecovery, type ShellIntegrationReport } from "@/app/view/term/shellintegration";

export type BlockStatusActionId =
    | "reconnect"
    | "reconnect-stalled"
    | "disconnect"
    | "copy"
    | "retry-helper"
    | "disable-helper"
    | "dismiss-helper-error"
    | "dismiss-helper-off"
    | "enable"
    | "recover-connection"
    | "restart"
    | "keep-running"
    | "not-now";

export type BlockStatusAction = {
    id: BlockStatusActionId;
    label: string;
    primary?: boolean;
    title?: string;
};

export type TerminalBlockStatusInputs = {
    report?: ShellIntegrationReport;
    integrationReported?: boolean;
    missingIntegrationSince?: number;
    durableEligible?: boolean;
};

export type BlockStatusInput = TerminalBlockStatusInputs & {
    connName?: string;
    connStatus?: ConnStatus;
    isTerminal: boolean;
    now: number;
    wshConfigEnabled?: boolean;
    helperOffDismissed?: boolean;
    isLayoutMode?: boolean;
    connModalOpen?: boolean;
};

export type BlockStatus = {
    kind: string;
    severity: "info" | "warning" | "error" | "progress";
    title: string;
    detail?: string;
    tooltip?: string;
    actions: BlockStatusAction[];
    dismiss?: BlockStatusActionId;
};

export function formatElapsedTime(elapsedMs: number): string {
    if (elapsedMs <= 0) {
        return "";
    }
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    if (elapsedSeconds < 60) {
        return `${elapsedSeconds}s`;
    }
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) {
        return `${elapsedMinutes}m`;
    }
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const remainingMinutes = elapsedMinutes % 60;
    if (elapsedHours < 24) {
        if (remainingMinutes === 0) {
            return `${elapsedHours}h`;
        }
        return `${elapsedHours}h${remainingMinutes}m`;
    }
    return "more than a day";
}

function shortReason(reason: string): string {
    const line = reason?.replace(/\s+/g, " ").trim();
    return line?.length > 120 ? `${line.slice(0, 117)}…` : line;
}

const Reconnect: BlockStatusAction = { id: "reconnect", label: "Reconnect", primary: true };
const CopyDetails: BlockStatusAction = { id: "copy", label: "Copy details" };

export function getBlockStatus(input: BlockStatusInput): BlockStatus | null {
    const { connStatus: conn, now, isTerminal } = input;
    const host = input.connName ?? conn?.connection;
    const connected = conn?.status == "connected";
    const stalled = connected && conn.connhealthstatus == "stalled";
    const helperFailed = connected && Boolean(conn.wsherror) && input.wshConfigEnabled !== false;
    if ((input.isLayoutMode || input.connModalOpen) && !stalled && !helperFailed) {
        return null;
    }
    if (host && conn != null) {
        if (conn.status == "error") {
            return {
                kind: "error",
                severity: "error",
                title: `Couldn't connect to ${host}`,
                detail: shortReason(conn.error),
                tooltip: conn.error,
                actions: [Reconnect, CopyDetails],
            };
        }
        if (!connected && conn.reconnecting && conn.nextreconnectts != null) {
            const seconds = Math.max(0, Math.ceil((conn.nextreconnectts - now) / 1000));
            return {
                kind: "reconnecting",
                severity: "progress",
                title: `Connection to ${host} lost`,
                detail: `Reconnecting in ${seconds}s (attempt ${conn.reconnectattempt ?? 1})`,
                actions: [
                    { ...Reconnect, label: "Reconnect now" },
                    { id: "disconnect", label: "Cancel" },
                ],
            };
        }
        if (conn.status == "connecting" || (!connected && conn.reconnecting)) {
            return { kind: "connecting", severity: "progress", title: `Connecting to ${host}…`, actions: [] };
        }
        if (!connected) {
            return {
                kind: "disconnected",
                severity: "warning",
                title: `Disconnected from ${host}`,
                actions: [Reconnect],
            };
        }
        if (stalled) {
            const elapsed =
                conn.lastactivitybeforestalledtime == null
                    ? ""
                    : formatElapsedTime(now - conn.lastactivitybeforestalledtime);
            return {
                kind: "stalled",
                severity: "warning",
                title: `${host} isn't responding`,
                detail: `No reply${elapsed ? ` for ${elapsed}` : ""} — it may recover on its own`,
                actions: [
                    { ...Reconnect, id: "reconnect-stalled" },
                    { id: "disconnect", label: "Disconnect" },
                ],
            };
        }
        if (helperFailed) {
            return {
                kind: "helper-failed",
                severity: "warning",
                title: "Connected without the GenieTerm helper",
                detail: "Command blocks and durable sessions are off",
                tooltip: conn.wsherror,
                actions: [
                    { id: "retry-helper", label: "Retry", primary: true },
                    { id: "disable-helper", label: "Don't use the helper" },
                    CopyDetails,
                ],
                dismiss: "dismiss-helper-error",
            };
        }
        if (!conn.wshenabled && conn.nowshreason == "installing wsh in background" && !conn.wsherror) {
            return {
                kind: "helper-installing",
                severity: "progress",
                title: `Installing the GenieTerm helper on ${host}`,
                detail:
                    (conn.wshinstallpct > 0 ? `${conn.wshinstallpct}% copied · ` : "") +
                    "This can take a while on a slow link — the terminal works meanwhile",
                actions: [],
            };
        }
    }
    if (!isTerminal) {
        return null;
    }
    if (
        !input.integrationReported &&
        input.missingIntegrationSince != null &&
        now - input.missingIntegrationSince >= 2500
    ) {
        const recovery = getShellIntegrationRecovery(conn, input.report);
        const helperOff = input.wshConfigEnabled === false || recovery?.action == "enable";
        if (recovery != null && !(helperOff && input.helperOffDismissed)) {
            const action = helperOff ? "enable" : recovery.action;
            const actions: BlockStatusAction[] =
                action == null
                    ? []
                    : [
                          {
                              id: action == "reconnect" ? "recover-connection" : (action as "enable" | "restart"),
                              label:
                                  action == "enable"
                                      ? "Enable and reconnect"
                                      : action == "reconnect"
                                        ? "Retry connection"
                                        : "Restart terminal",
                              primary: true,
                              title:
                                  action == "restart"
                                      ? "Restarts this terminal and ends its current shell process"
                                      : "Reconnects this host, interrupting its terminals, and restarts this shell",
                          },
                      ];
            return {
                kind: helperOff ? "helper-off" : "shell-integration",
                severity: helperOff || action == null ? "info" : "warning",
                title: helperOff ? "The GenieTerm helper is off for this connection" : recovery.message,
                detail: helperOff ? "Command blocks and durable sessions are off" : undefined,
                actions,
                dismiss: helperOff ? "dismiss-helper-off" : undefined,
            };
        }
    }
    if (input.durableEligible) {
        return {
            kind: "durable-prompt",
            severity: "info",
            title: "Keep this session running if GenieTerm quits?",
            actions: [
                { id: "keep-running", label: "Keep running", primary: true },
                { id: "not-now", label: "Not now" },
            ],
            dismiss: "not-now",
        };
    }
    return null;
}
