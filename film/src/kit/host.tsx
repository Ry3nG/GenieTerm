import React from "react";
import { GpuCard, type GpuCardData } from "../lib/gpucard";
import { IconArrows } from "./icons";
import { T } from "./tokens";
import { Host, mono, sans } from "./ui";

// The Host view (view/host): a summary column, then the selected tab. Numbers describe the
// film's one training run and agree with the GPU card and the terminal.

export const FilmGpuData: GpuCardData = {
    name: "NVIDIA GeForce RTX 5090",
    util: 97,
    memUsed: 21.4,
    memTotal: 31.8,
    temp: 71,
    power: 512,
    powerLimit: 575,
    process: { command: "python train.py", user: "ml", mem: 20.9 },
};

export const Processes = [
    { pid: 48211, cmd: "python train.py", user: "ml", cpu: "104%", mem: "20.9 GB", gpu: "97%" },
    { pid: 48390, cmd: "tensorboard", user: "ml", cpu: "2.1%", mem: "412 MB", gpu: "—" },
    { pid: 1022, cmd: "sshd: ml@pts/0", user: "ml", cpu: "0.2%", mem: "9 MB", gpu: "—" },
    { pid: 873, cmd: "dockerd", user: "root", cpu: "0.1%", mem: "88 MB", gpu: "—" },
];

export const Ports = [
    { port: 6006, proc: "tensorboard", addr: "127.0.0.1" },
    { port: 22, proc: "sshd", addr: "0.0.0.0" },
];

const SummaryRow: React.FC<{ label: string; value: string; sub: string; active?: boolean; bar: number; y: number }> = ({ label, value, sub, active, bar, y }) => (
    <div
        style={{
            position: "absolute",
            left: 8,
            right: 8,
            top: y,
            height: 52,
            borderRadius: 8,
            background: active ? "rgba(255,255,255,0.07)" : "transparent",
            padding: "8px 10px",
            boxSizing: "border-box",
        }}
    >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={sans(12, 500)}>{label}</span>
            <span style={{ ...sans(12.5, 500, "#3d8bff"), fontVariantNumeric: "tabular-nums" }}>{value}</span>
        </div>
        <div style={{ ...sans(10.5, 400, T.muted), marginTop: 2 }}>{sub}</div>
        <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }}>
            <div style={{ width: `${bar}%`, height: "100%", borderRadius: 2, background: "#3d8bff" }} />
        </div>
    </div>
);

export const HostView: React.FC<{ build: number; frame: number; width: number; tab?: "overview" | "processes"; rowGlow?: number; portGlow?: number }> = ({
    build,
    width,
    frame,
    tab = "overview",
    rowGlow = 0,
    portGlow = 0,
}) => {
    const g = FilmGpuData;
    // the GPU card keeps the app's 508 px layout and scales to the column, as the app's grid does
    const cardScale = Math.min(1, (width - 232) / 508);
    const e = 1 - Math.pow(1 - Math.min(1, build), 3);
    const util = Math.round(g.util * e + (e >= 1 ? Math.sin(frame / 23) * 1.2 : 0));
    return (
        <div style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", left: 12, right: 12, top: 0, height: 30, display: "flex", alignItems: "center", gap: 8 }}>
                <IconArrows size={13} color="#5fafff" />
                <span style={sans(12.5, 600)}>Host</span>
                <span style={sans(12.5, 400, T.secondary)}>{Host.name}</span>
            </div>
            <div style={{ position: "absolute", left: 0, top: 34, width: 200, bottom: 0, borderRight: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ position: "absolute", left: 18, top: 6, ...sans(16, 600) }}>
                    {Host.name}
                    <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.08)", ...sans(10, 500, T.secondary) }}>SSH</span>
                </div>
                <SummaryRow y={42} label="GPU 0" value={`${util}%`} sub={`${(g.memUsed * e).toFixed(1)}/${g.memTotal} GB · ${Math.round(30 + (g.temp - 30) * e)} °C`} active bar={util} />
                <SummaryRow y={100} label="CPU" value="14%" sub="Load 3.92 · 32 cores" bar={14} />
                <SummaryRow y={158} label="Memory" value="31%" sub="39.6 GB of 128 GB" bar={31} />
                <SummaryRow y={216} label="Network" value="" sub="↓ 2.1 MB/s ↑ 84 KB/s" bar={0} />
            </div>
            <div style={{ position: "absolute", left: 218, right: 14, top: 40 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
                    {["Overview", "Processes", "Ports"].map((t) => (
                        <span
                            key={t}
                            style={{
                                padding: "4px 12px",
                                borderRadius: 6,
                                background: t.toLowerCase() === tab ? "rgba(255,255,255,0.1)" : "transparent",
                                ...sans(11.5, 500, t.toLowerCase() === tab ? T.fg : T.muted),
                            }}
                        >
                            {t}
                        </span>
                    ))}
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={sans(12.5, 600)}>GPUs</span>
                    <span style={sans(11.5, 400, T.muted)}>{g.name} · Driver 580.78 · CUDA 13.0</span>
                </div>
                <div style={{ position: "relative", height: 227 * cardScale, marginTop: 10 }}>
                    <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `scale(${cardScale})` }}>
                        <GpuCard x={0} y={0} data={g} build={build} frame={frame} />
                    </div>
                </div>
                <div style={{ marginTop: 18, ...sans(12.5, 600) }}>Processes</div>
                <div style={{ marginTop: 8, borderRadius: 10, background: "#1e1e20", border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    {Processes.map((p, i) => (
                        <div
                            key={p.pid}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                height: 30,
                                padding: "0 14px",
                                borderTop: i ? "1px solid rgba(255,255,255,0.05)" : "none",
                                background: i === 0 ? `rgba(41,151,255,${0.14 * rowGlow})` : "transparent",
                            }}
                        >
                            <span style={{ width: 56, ...mono(11.5, T.muted) }}>{p.pid}</span>
                            <span style={{ flex: 1, ...mono(12, T.fg) }}>{p.cmd}</span>
                            <span style={{ width: 50, ...sans(11.5, 400, T.muted) }}>{p.user}</span>
                            <span style={{ width: 60, textAlign: "right", ...sans(11.5, 400, T.secondary) }}>{p.cpu}</span>
                            <span style={{ width: 76, textAlign: "right", ...sans(11.5, 400, T.secondary) }}>{p.mem}</span>
                            <span style={{ width: 52, textAlign: "right", ...sans(11.5, 500, p.gpu === "—" ? T.muted : "#3d8bff") }}>{p.gpu}</span>
                        </div>
                    ))}
                </div>
                <div style={{ marginTop: 18, ...sans(12.5, 600) }}>Listening ports</div>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    {Ports.map((p, i) => (
                        <div
                            key={p.port}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 12px",
                                borderRadius: 8,
                                background: i === 0 ? `rgba(41,151,255,${0.08 + 0.14 * portGlow})` : "rgba(255,255,255,0.04)",
                                border: `1px solid ${i === 0 ? `rgba(41,151,255,${0.2 + 0.5 * portGlow})` : "rgba(255,255,255,0.06)"}`,
                            }}
                        >
                            <span style={mono(12.5, T.fg)}>:{p.port}</span>
                            <span style={sans(11.5, 400, T.muted)}>{p.proc}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
