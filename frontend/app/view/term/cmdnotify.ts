// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatCwdLabel } from "@/util/pathlabel";
import { isLocalConnName } from "@/util/util";
import { isUserInterruptExit } from "./cmdblockdisplay";
import { blockHasCommand, isCmdBlockCommandPlaceholder, type CmdBlock } from "./cmdblocks";

const NotificationIntervalMs = 3000;
const MaxTitleChars = 60;

export type CommandNotificationDecision = {
    block: CmdBlock;
    thresholdSeconds: number;
    windowFocused: boolean;
    tabActive: boolean;
    blockFocused: boolean;
    nowMs: number;
    lastNotificationMs?: number;
};

export function shouldNotifyCommandDone(input: CommandNotificationDecision): boolean {
    const { block, thresholdSeconds, windowFocused, tabActive, blockFocused, nowMs, lastNotificationMs } = input;
    if (!Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
        return false;
    }
    if (!blockHasCommand(block) || isCmdBlockCommandPlaceholder(block.command) || block.state !== "done") {
        return false;
    }
    if (!block.startTs || block.doneTs == null || block.interrupted || isUserInterruptExit(block.exitCode)) {
        return false;
    }
    const durationMs = block.doneTs - block.startTs;
    if (!Number.isFinite(durationMs) || durationMs < thresholdSeconds * 1000) {
        return false;
    }
    if (windowFocused && tabActive && blockFocused) {
        return false;
    }
    return lastNotificationMs == null || nowMs - lastNotificationMs >= NotificationIntervalMs;
}

export function formatCommandNotificationDuration(durationMs: number): string {
    const seconds = Math.floor(Math.max(0, durationMs) / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    }
    return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

export function formatCommandNotification(
    block: CmdBlock,
    connection?: string,
    localHome?: string
): WaveNotificationOptions {
    const command = Array.from(block.command.trim().replace(/\s+/g, " "));
    const title =
        command.length > MaxTitleChars ? command.slice(0, MaxTitleChars - 1).join("") + "…" : command.join("");
    const duration = formatCommandNotificationDuration(block.doneTs - block.startTs);
    let body = `Finished after ${duration}`;
    if (block.exitCode === 0) {
        body = `Finished in ${duration}`;
    } else if (block.exitCode != null) {
        body = `Failed with exit code ${block.exitCode} after ${duration}`;
    }
    const where =
        isLocalConnName(connection) || connection === "conn:local" ? formatCwdLabel(block.cwd, localHome) : connection;
    if (where) {
        body += ` · ${where}`;
    }
    return { title, body, silent: false };
}
