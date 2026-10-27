// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { normalizeHistoryEntry, type CommandHistoryEntry, type CommandLibraryContext } from "@/util/commandlibrary";
import { isCmdBlockCommandPlaceholder, type CmdBlock } from "./cmdblocks";

export function makeCommandHistoryEntry(context: CommandLibraryContext, block: CmdBlock): CommandHistoryEntry | null {
    if (!block?.command || !block.startTs || isCmdBlockCommandPlaceholder(block.command)) {
        return null;
    }
    return normalizeHistoryEntry({
        ...context,
        id: `${context.blockid}:${block.id}:${block.startTs}`,
        commandblockid: block.id,
        command: block.command,
        cwd: block.cwd ?? context.cwd ?? "",
        startts: block.startTs,
        donets: block.doneTs,
        exitcode: block.exitCode,
        status:
            block.state === "running"
                ? "running"
                : block.interrupted || block.exitCode == null
                  ? "unknown"
                  : block.exitCode === 0
                    ? "success"
                    : "failed",
    });
}

export function matchesRetainedCommand(entry: CommandHistoryEntry, blockid: string, block: CmdBlock): boolean {
    return (
        entry.blockid === blockid &&
        entry.commandblockid === block.id &&
        entry.startts === block.startTs &&
        entry.command === block.command &&
        block.startMarker != null &&
        block.startMarker.line >= 0 &&
        !block.startMarker.isDisposed
    );
}
