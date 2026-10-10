// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { FeatureItem, TourFooter, TourPage, TourWindow } from "./onboarding-tour";

const HostFeatures: FeatureItem[] = [
    {
        icon: "fa-display",
        title: "Every GPU at a glance",
        description: "Utilization, memory, temperature and power for each card, and which process holds it.",
    },
    {
        icon: "fa-arrow-right-to-bracket",
        title: "Forward a port in one click",
        description: "Jupyter, TensorBoard or a dev server on the host opens on localhost. No ssh -L.",
    },
    {
        icon: "fa-list-tree",
        title: "Processes and ports together",
        description: "Find a runaway process or the server behind a port without leaving the workspace.",
    },
];

const DemoGpus = [
    { index: 0, util: 97, mem: 76 },
    { index: 1, util: 95, mem: 76 },
    { index: 2, util: 98, mem: 77 },
    { index: 3, util: 0, mem: 1 },
];

function HostIllustration() {
    return (
        <TourWindow icon="fa-server" title="gpu-01 · 4 × H100">
            <div className="flex h-full flex-col gap-2.5 font-sans text-[11.5px]">
                <div className="grid grid-cols-2 gap-2">
                    {DemoGpus.map((gpu) => (
                        <div key={gpu.index} className="rounded-lg border border-border bg-hover px-2.5 py-2">
                            <div className="flex items-baseline justify-between">
                                <span className="text-secondary">GPU {gpu.index}</span>
                                <span className="text-[14px] font-semibold tabular-nums text-accent">{gpu.util}%</span>
                            </div>
                            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/10">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${gpu.mem}%` }} />
                            </div>
                            <div className="mt-1 text-[10.5px] tabular-nums text-muted">
                                {gpu.index === 3 ? "idle" : `${Math.round(gpu.mem * 0.8)}/80 GB · python`}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-auto flex flex-col gap-1">
                    {[
                        { port: 8888, name: "Jupyter", forwarded: true },
                        { port: 6006, name: "TensorBoard", forwarded: false },
                    ].map((row) => (
                        <div
                            key={row.port}
                            className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-1.5"
                        >
                            <span className="w-9 font-mono font-semibold tabular-nums text-primary">{row.port}</span>
                            <span className="min-w-0 flex-1 truncate text-secondary">{row.name}</span>
                            <span
                                className={cn(
                                    "rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                                    row.forwarded ? "bg-accent/80 text-primary" : "border border-border text-secondary"
                                )}
                            >
                                {row.forwarded ? "Open" : "Forward & open"}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </TourWindow>
    );
}

export const HostPage = ({ onFinish, onPrev }: { onFinish: () => void; onPrev?: () => void }) => {
    return (
        <TourPage
            eyebrow="Host"
            title="The machine, not just the shell"
            lede="Host shows what a machine is doing, whether it's this Mac or a GPU box over SSH: CPU, memory, GPUs, processes, and the ports its servers listen on."
            features={HostFeatures}
            illustration={<HostIllustration />}
            footer={<TourFooter step={4} total={4} onNext={onFinish} onPrev={onPrev} />}
        />
    );
};
