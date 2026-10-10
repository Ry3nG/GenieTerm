// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isCmdBlockCommandPlaceholder, type CmdBlock } from "./cmdblocks";
import type { ShellIntegrationStatus } from "./osc-handlers";

export type CmdBlockStatusTone = "running" | "success" | "error" | "unknown";

export type CmdBlockStatusDisplay = {
    label: string;
    tone: CmdBlockStatusTone;
    iconClass: string;
};

export function formatCmdBlockDuration(block: CmdBlock, nowTs = Date.now()): string {
    if (!block?.startTs || (block.state === "done" && block.doneTs == null)) {
        return "";
    }
    const endTs = block.doneTs ?? nowTs;
    const elapsedMs = Math.max(0, endTs - block.startTs);
    if (elapsedMs < 60_000) {
        return `${(elapsedMs / 1000).toFixed(1)}s`;
    }
    if (elapsedMs < 3_600_000) {
        const minutes = Math.floor(elapsedMs / 60_000);
        const seconds = Math.floor((elapsedMs % 60_000) / 1000);
        return `${minutes}m ${seconds}s`;
    }
    const hours = Math.floor(elapsedMs / 3_600_000);
    const minutes = Math.floor((elapsedMs % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
}

export function getCmdBlockStatus(block: CmdBlock): CmdBlockStatusDisplay {
    if (block?.state !== "done") {
        return {
            label: "Running",
            tone: "running",
            iconClass: "fa-solid fa-spinner fa-spin",
        };
    }
    if (block.interrupted) {
        return {
            label: "Interrupted",
            tone: "unknown",
            iconClass: "fa-solid fa-circle-minus",
        };
    }
    if (block.exitCode == null) {
        return {
            label: "Finished",
            tone: "unknown",
            iconClass: "fa-solid fa-circle-question",
        };
    }
    if (block.exitCode === 0) {
        return {
            label: "OK",
            tone: "success",
            iconClass: "fa-solid fa-check",
        };
    }
    return {
        label: `Exit ${block.exitCode}`,
        tone: "error",
        iconClass: "fa-solid fa-xmark",
    };
}

export function getCmdBlockTitle(block: CmdBlock, nowTs = Date.now()): string {
    const status = getCmdBlockStatus(block);
    return [block?.command, status.label, formatCmdBlockDuration(block, nowTs), block?.cwd].filter(Boolean).join(" - ");
}

export type CommandRunGate = {
    shellIntegrationStatus: ShellIntegrationStatus | null;
    altScreenActive: boolean;
};

// Typing a command is only safe at an idle prompt: anything else would feed the text
// to whatever program currently owns the terminal.
export function getCommandRunBlockedReason(command: string | null | undefined, gate: CommandRunGate): string | null {
    if (!command?.trim()) {
        return "No command to run";
    }
    if (isCmdBlockCommandPlaceholder(command)) {
        return "This command was too large to record";
    }
    if (gate.altScreenActive) {
        return "Unavailable while a full-screen program is running";
    }
    if (gate.shellIntegrationStatus === "running-command") {
        return "Unavailable while another command is running";
    }
    if (gate.shellIntegrationStatus !== "ready") {
        return "Unavailable until the shell reports it is at a prompt";
    }
    return null;
}
