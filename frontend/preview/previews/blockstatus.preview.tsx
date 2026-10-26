// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getBlockStatus, type BlockStatusInput } from "@/app/block/blockstatus";
import { BlockStatusLineContent } from "@/app/block/blockstatusline";
import * as React from "react";

const Now = 100000;
const Connected = { connection: "root@aceroboticssg_cci", status: "connected", wshenabled: true } as ConnStatus;
const Cases: { name: string; conn?: Partial<ConnStatus>; input?: Partial<BlockStatusInput> }[] = [
    {
        name: "Error",
        conn: { status: "error", error: "Permission denied (publickey). Check your SSH key and try again." },
    },
    {
        name: "Reconnecting",
        conn: { status: "disconnected", reconnecting: true, nextreconnectts: Now + 4000, reconnectattempt: 2 },
    },
    { name: "Connecting", conn: { status: "connecting" } },
    { name: "Disconnected", conn: { status: "disconnected" } },
    { name: "Stalled", conn: { connhealthstatus: "stalled", lastactivitybeforestalledtime: Now - 50000 } },
    { name: "Helper failed", conn: { wshenabled: false, wsherror: "SSH forwarding denied" } },
    { name: "Helper installing", conn: { wshenabled: false, nowshreason: "installing wsh in background" } },
    { name: "Helper off", conn: { wshenabled: false, nowshreason: "conn:wshenabled set to false" } },
    { name: "Shell not reported" },
    { name: "PowerShell needs PSReadLine", input: { report: { integrationDisabled: true, shellType: "pwsh" } } },
    { name: "Shell unsupported", input: { report: { integrationDisabled: true, shellType: "unknown" } } },
    { name: "Helper unavailable", conn: { wshenabled: false, nowshreason: "helper not ready" } },
    { name: "Durable prompt", input: { integrationReported: true, durableEligible: true } },
];

export function BlockStatusPreview() {
    const [lastAction, setLastAction] = React.useState("No action yet");
    const [failActions, setFailActions] = React.useState(false);
    return (
        <div className="flex w-full flex-col gap-4 p-4">
            <h1 className="text-primary text-sm">Block status line · 320px and 640px</h1>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                <input
                    type="checkbox"
                    checked={failActions}
                    onChange={(event) => setFailActions(event.target.checked)}
                />
                Simulate RPC failure
            </label>
            <output className="text-xs text-muted">{lastAction}</output>
            <div className="flex flex-wrap items-start gap-6">
                {[320, 640].map((width) => (
                    <div key={width} className="flex max-w-full flex-col gap-3" style={{ width }}>
                        {Cases.map(({ name, conn, input }) => (
                            <section
                                key={name}
                                data-status-preview={`${name}-${width}`}
                                className="overflow-hidden rounded-md border border-border bg-panel"
                            >
                                <div className="flex h-7 items-center border-b border-border px-2.5 text-[11px] text-muted">
                                    {name} · {width}px
                                </div>
                                <BlockStatusLineContent
                                    status={getBlockStatus({
                                        isTerminal: true,
                                        connStatus: { ...Connected, ...conn },
                                        now: Now,
                                        missingIntegrationSince: Now - 2500,
                                        ...input,
                                    })}
                                    onAction={async (action) => {
                                        setLastAction(`Running ${action}`);
                                        await new Promise((resolve) => setTimeout(resolve, 700));
                                        if (failActions) {
                                            throw new Error("The host did not reply. Try again.");
                                        }
                                        setLastAction(`Completed ${action}`);
                                    }}
                                />
                                <div className="flex h-7 items-center px-2.5 font-mono text-[11px] text-muted">
                                    $ terminal content stays below the status
                                </div>
                            </section>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
