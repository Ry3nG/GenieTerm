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
    "  > Fix the failing cache tests and explain the changes.",
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
    const reattached = new URLSearchParams(window.location.search).get("state") === "reattached";
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
                      "  Fixed the cache invalidation and updated the regression tests.",
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
        <div className="w-full max-w-[1128px] p-6">
            <div data-site-terminal className="w-full overflow-hidden rounded-lg border border-border bg-background">
                <BlockStatusLineContent status={status} onAction={async () => {}} />
                <div ref={container} className="h-[500px] p-5" />
            </div>
        </div>
    );
}
