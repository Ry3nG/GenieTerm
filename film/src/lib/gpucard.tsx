import React from "react";
import { SansFamily } from "./fonts";

// GenieTerm's Host GPU card, redrawn in vector on the app's own 508x227 layout so it can
// carry staged, self-consistent numbers and animate them. Values here describe the film's
// training run (one 58M-parameter model on one RTX 5090), not whatever else shares the GPU.

export type GpuCardData = {
    name: string;
    util: number;
    memUsed: number;
    memTotal: number;
    temp: number;
    power: number;
    powerLimit: number;
    process: { command: string; user: string; mem: number };
};

export const FilmGpu: GpuCardData = {
    name: "NVIDIA GeForce RTX 5090",
    util: 96,
    memUsed: 3.6,
    memTotal: 31.8,
    temp: 66,
    power: 468,
    powerLimit: 575,
    process: { command: "python", user: "ml", mem: 3.4 },
};

const W = 508;
const H = 227;

// History: idle, the run starting up, then a busy plateau with a little texture.
function utilHistory(points: number, live: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < points; i++) {
        const p = i / (points - 1);
        const rise = p < 0.22 ? 3 : p < 0.34 ? 3 + ((p - 0.22) / 0.12) * 90 : 93;
        const texture = p >= 0.34 ? 2.4 * Math.sin(i * 1.7 + live * 0.05) + 1.4 * Math.cos(i * 0.61) : 0;
        out.push(Math.max(0, Math.min(100, rise + texture)));
    }
    return out;
}

export const GpuCard: React.FC<{
    x: number;
    y: number;
    data?: GpuCardData;
    // 0..1: how far the history line has drawn and the numbers have counted in
    build: number;
    frame: number;
}> = ({ x, y, data = FilmGpu, build, frame }) => {
    const ease = 1 - Math.pow(1 - Math.min(1, build), 3);
    const util = Math.round(data.util * ease + (ease >= 1 ? Math.sin(frame / 23) * 1.4 : 0));
    const mem = (data.memUsed * ease).toFixed(1);
    const temp = Math.round(30 + (data.temp - 30) * ease);
    const power = Math.round(60 + (data.power - 60) * ease);
    const chart = { x: 17, y: 62, w: 466, h: 47 };
    const pts = utilHistory(60, frame);
    const shown = Math.max(2, Math.round(pts.length * Math.min(1, build * 1.1)));
    const path = pts
        .slice(0, shown)
        .map((v, i) => `${i === 0 ? "M" : "L"} ${chart.x + (i / (pts.length - 1)) * chart.w} ${chart.y + chart.h - (v / 100) * chart.h}`)
        .join(" ");
    const area = `${path} L ${chart.x + ((shown - 1) / (pts.length - 1)) * chart.w} ${chart.y + chart.h} L ${chart.x} ${chart.y + chart.h} Z`;
    const label: React.CSSProperties = { fontSize: 11.5, color: "rgba(255,255,255,0.5)" };
    const value: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.94)", marginTop: 3 };
    return (
        <div
            style={{
                position: "absolute",
                left: x,
                top: y,
                width: W,
                height: H,
                borderRadius: 10,
                background: "#1e1e20",
                border: "1px solid rgba(255,255,255,0.08)",
                fontFamily: SansFamily,
                overflow: "hidden",
            }}
        >
            <div style={{ position: "absolute", left: 17, top: 15, width: 28, height: 28, borderRadius: 7, background: "#1b2a40" }}>
                <svg viewBox="0 0 24 24" width={16} height={16} style={{ position: "absolute", left: 6, top: 6 }}>
                    <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="#4d8dff" strokeWidth="2" />
                    <path d="M8 20h8M12 16v4" stroke="#4d8dff" strokeWidth="2" strokeLinecap="round" />
                </svg>
            </div>
            <div style={{ position: "absolute", left: 56, top: 17, fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.95)" }}>GPU 0</div>
            <div style={{ position: "absolute", left: 56, top: 35, fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>{data.name}</div>
            <div style={{ position: "absolute", right: 17, top: 16, fontSize: 22, fontWeight: 600, color: "#3d8bff", letterSpacing: "-0.01em" }}>{util}%</div>
            <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
                <defs>
                    <linearGradient id="gpuFill" x1="0" y1={chart.y} x2="0" y2={chart.y + chart.h} gradientUnits="userSpaceOnUse">
                        <stop offset="0" stopColor="#2c4268" stopOpacity="0.95" />
                        <stop offset="1" stopColor="#1f2229" stopOpacity="0.9" />
                    </linearGradient>
                    <clipPath id="gpuChart">
                        <rect x={chart.x} y={chart.y} width={chart.w} height={chart.h} rx={6} />
                    </clipPath>
                </defs>
                <rect x={chart.x} y={chart.y} width={chart.w} height={chart.h} rx={6} fill="#19191b" stroke="rgba(255,255,255,0.06)" />
                <line x1={chart.x} x2={chart.x + chart.w} y1={chart.y + chart.h / 2} y2={chart.y + chart.h / 2} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                <g clipPath="url(#gpuChart)">
                    <path d={area} fill="url(#gpuFill)" />
                    <path d={path} fill="none" stroke="#4d8dff" strokeWidth={1.6} strokeLinejoin="round" />
                </g>
            </svg>
            <div style={{ position: "absolute", left: 17, top: 123 }}>
                <div style={label}>Memory</div>
                <div style={value}>
                    {mem}/{data.memTotal} GB
                </div>
                <div style={{ marginTop: 8, width: 190, height: 6, borderRadius: 3, background: "#363638", overflow: "hidden" }}>
                    <div style={{ width: `${(Number(mem) / data.memTotal) * 100}%`, height: "100%", borderRadius: 3, background: "#4d8dff" }} />
                </div>
            </div>
            <div style={{ position: "absolute", left: 218, top: 123 }}>
                <div style={label}>Temperature</div>
                <div style={{ ...value, color: temp >= 80 ? "#e3b955" : "rgba(255,255,255,0.94)" }}>{temp} °C</div>
            </div>
            <div style={{ position: "absolute", left: 357, top: 123 }}>
                <div style={label}>Power</div>
                <div style={value}>
                    {power}/{data.powerLimit} W
                </div>
            </div>
            <div style={{ position: "absolute", left: 17, right: 17, top: 178, height: 1, background: "rgba(255,255,255,0.08)" }} />
            <div style={{ position: "absolute", left: 17, top: 191, fontSize: 12.5, color: "rgba(255,255,255,0.78)" }}>{data.process.command}</div>
            <div style={{ position: "absolute", left: 400, top: 191, fontSize: 12.5, color: "rgba(255,255,255,0.45)" }}>{data.process.user}</div>
            <div style={{ position: "absolute", right: 17, top: 191, fontSize: 12.5, color: "rgba(255,255,255,0.78)" }}>{data.process.mem} GB</div>
        </div>
    );
};

// The Host sidebar's GPU row repeats the card's numbers; redraw just those two spans.
export const SidebarGpuPatch: React.FC<{ data?: GpuCardData; util?: number }> = ({ data = FilmGpu, util }) => (
    <>
        <div
            style={{
                position: "absolute",
                left: 956,
                top: 194,
                width: 38,
                height: 17,
                background: "#111112",
                textAlign: "right",
                fontFamily: SansFamily,
                fontSize: 13,
                fontWeight: 500,
                color: "#3d8bff",
                lineHeight: "17px",
            }}
        >
            {util ?? data.util}%
        </div>
        <div
            style={{
                position: "absolute",
                left: 817,
                top: 212,
                width: 118,
                height: 16,
                background: "#111112",
                fontFamily: SansFamily,
                fontSize: 11.5,
                color: "rgba(255,255,255,0.5)",
                lineHeight: "16px",
                paddingLeft: 1,
            }}
        >
            {data.memUsed}/{data.memTotal} GB · {data.temp} °C
        </div>
    </>
);
