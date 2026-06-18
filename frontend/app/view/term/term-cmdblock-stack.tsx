// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import * as React from "react";
import { formatCmdBlockDuration, getCmdBlockStatus } from "./cmdblockdisplay";
import { type CmdBlock, blockHasCommand } from "./cmdblocks";

const ToneColor: Record<string, string> = {
    success: "var(--success-color)",
    error: "var(--error-color)",
    running: "var(--accent-color)",
};

function copyText(text: string) {
    if (text) {
        navigator.clipboard?.writeText(text);
    }
}

const CmdBlockItem = React.memo(({ block }: { block: CmdBlock }) => {
    const [collapsed, setCollapsed] = React.useState(false);
    const status = getCmdBlockStatus(block);
    const duration = formatCmdBlockDuration(block);
    const hasOutput = !!block.htmlOutput && block.htmlOutput.trim() !== "";
    return (
        <div className={cn("term-cmdblock", `is-${status.tone}`)}>
            <div className="term-cmdblock-header" onClick={() => setCollapsed((v) => !v)}>
                <i
                    className={cn("term-cmdblock-status", status.iconClass)}
                    style={{ color: ToneColor[status.tone] }}
                    aria-hidden="true"
                />
                <span className="term-cmdblock-cmd">{block.command}</span>
                <span className="term-cmdblock-dur">{duration}</span>
                <button
                    type="button"
                    className="term-cmdblock-action"
                    title="Copy command"
                    aria-label="Copy command"
                    onClick={(e) => {
                        e.stopPropagation();
                        copyText(block.command ?? "");
                    }}
                >
                    <i className="fa fa-solid fa-terminal" aria-hidden="true" />
                </button>
                <i
                    className={cn(
                        "term-cmdblock-chevron fa fa-solid",
                        collapsed ? "fa-chevron-right" : "fa-chevron-down"
                    )}
                    aria-hidden="true"
                />
            </div>
            {!collapsed && hasOutput && (
                <div className="term-cmdblock-output" dangerouslySetInnerHTML={{ __html: block.htmlOutput }} />
            )}
        </div>
    );
});
CmdBlockItem.displayName = "CmdBlockItem";

// Renders completed command blocks as a vertical stack of real DOM blocks
// (header + captured ANSI output). The currently-running command stays in the
// live xterm below.
export function TermCommandBlockStack({ blocks }: { blocks: CmdBlock[] }) {
    const doneBlocks = (blocks ?? []).filter((b) => b.state === "done" && blockHasCommand(b));
    if (doneBlocks.length === 0) {
        return null;
    }
    return (
        <div className="term-cmdblock-stack">
            {doneBlocks.map((b) => (
                <CmdBlockItem key={b.id} block={b} />
            ))}
        </div>
    );
}
