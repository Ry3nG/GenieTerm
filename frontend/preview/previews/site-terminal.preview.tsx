// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { getBlockStatus } from "@/app/block/blockstatus";
import { BlockStatusLineContent } from "@/app/block/blockstatusline";
import { computeTheme } from "@/app/view/term/termutil";
import "@/app/view/term/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { DefaultFullConfig } from "../mock/defaultconfig";

const AgentOutput = [
    "\x1b[32mdemo@atlas\x1b[0m \x1b[34m~/project\x1b[0m $ claude",
    "",
    "\x1b[38;5;173m  Claude Code\x1b[0m",
    "  > Fix the failing cache tests.",
    "    Explain the changes when you're done.",
    "",
    "  ● Read(src/cache.ts)",
    "  ● Edit(src/cache.ts)",
    "    Updated cache invalidation for expired entries.",
    "",
    "  ● Bash(npm test)",
    "    ⎿  3 failed, 39 passed",
    "",
    "  ● Read(tests/cache.test.ts)",
];

export function SiteTerminalPreview() {
    const container = useRef<HTMLDivElement>(null);
    const params = new URLSearchParams(window.location.search);
    const reattached = params.get("state") === "reattached";
    const width = Math.max(320, Math.min(1080, Number(params.get("width")) || 1080));
    useEffect(() => {
        const [theme] = computeTheme(DefaultFullConfig, "default-dark", 0);
        const terminal = new Terminal({
            theme,
            fontFamily: "Hack, monospace",
            fontSize: 15,
            cursorBlink: false,
            disableStdin: true,
            allowTransparency: true,
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(container.current);
        let disposed = false;
        void document.fonts.ready.then(() => {
            if (disposed) return;
            fit.fit();
            const output = reattached
                ? [
                      ...AgentOutput,
                      "  ● Edit(tests/cache.test.ts)",
                      "",
                      "  ● Bash(npm test)",
                      "\x1b[32m    ⎿  42 passed in 18.4s\x1b[0m",
                      "",
                      "  Fixed cache invalidation and updated the",
                      "  regression tests. All checks pass.",
                      "  > ",
                  ]
                : AgentOutput;
            terminal.write(output.join("\r\n"), () => container.current?.setAttribute("data-ready", "true"));
        });
        return () => {
            disposed = true;
            terminal.dispose();
        };
    }, [reattached]);
    const status = getBlockStatus({
        isTerminal: true,
        integrationReported: true,
        now: 100000,
        connStatus: {
            connection: "atlas",
            status: reattached ? "connected" : "disconnected",
            reconnecting: !reattached,
            reconnectattempt: 2,
            nextreconnectts: 104000,
            wshenabled: true,
        } as ConnStatus,
    });
    return (
        <div className="w-full p-6" style={{ maxWidth: width + 48 }}>
            <div
                data-site-terminal
                className="flex h-[560px] w-full flex-col overflow-hidden rounded-lg border border-border bg-black"
            >
                <div className="min-h-[45px] shrink-0">
                    <BlockStatusLineContent status={status} onAction={async () => {}} />
                </div>
                <div className="min-h-0 flex-1 p-5">
                    <div ref={container} className="h-full w-full" />
                </div>
            </div>
        </div>
    );
}
