import React from "react";
import { MonoFamily, SansFamily } from "../lib/fonts";
import { lossAt } from "./data";

// The dashboard the forwarded port serves: the run's loss, drawn from the same numbers the
// terminal prints. A clean light page, the way the real one opens in a browser.

export const LossChart: React.FC<{ width: number; height: number; upTo: number; draw: number }> = ({ width, height, upTo, draw }) => {
    const pad = { l: 56, r: 24, t: 20, b: 40 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;
    const maxE = 100;
    const yMin = 1.8;
    const yMax = 7;
    const X = (e: number) => pad.l + (e / maxE) * w;
    const Y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * h;
    const last = Math.max(2, Math.round(upTo * draw));
    const pts: string[] = [];
    const raw: string[] = [];
    let ema = lossAt(1);
    for (let e = 1; e <= last; e++) {
        const v = lossAt(e) + Math.sin(e * 2.3) * 0.05 * Math.exp(-e / 40);
        ema = ema * 0.6 + v * 0.4;
        raw.push(`${e === 1 ? "M" : "L"} ${X(e).toFixed(1)} ${Y(v).toFixed(1)}`);
        pts.push(`${e === 1 ? "M" : "L"} ${X(e).toFixed(1)} ${Y(ema).toFixed(1)}`);
    }
    const head = { x: X(last), y: Y(ema) };
    return (
        <svg width={width} height={height} style={{ display: "block" }}>
            {[2, 3, 4, 5, 6, 7].map((v) => (
                <g key={v}>
                    <line x1={pad.l} x2={pad.l + w} y1={Y(v)} y2={Y(v)} stroke="#e6e6ea" />
                    <text x={pad.l - 10} y={Y(v) + 4} textAnchor="end" fontFamily={SansFamily} fontSize={12} fill="#8a8a92">
                        {v}
                    </text>
                </g>
            ))}
            {[0, 20, 40, 60, 80, 100].map((e) => (
                <text key={e} x={X(e)} y={pad.t + h + 22} textAnchor="middle" fontFamily={SansFamily} fontSize={12} fill="#8a8a92">
                    {e}
                </text>
            ))}
            <path d={raw.join(" ")} fill="none" stroke="#2997ff" strokeOpacity={0.25} strokeWidth={1.4} />
            <path d={pts.join(" ")} fill="none" stroke="#2997ff" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={head.x} cy={head.y} r={4.5} fill="#2997ff" stroke="#fff" strokeWidth={2} />
        </svg>
    );
};

export const TensorBoardPage: React.FC<{ width: number; height: number; upTo: number; draw: number }> = ({ width, height, upTo, draw }) => (
    <div style={{ position: "absolute", inset: 0, background: "#f5f5f7", fontFamily: SansFamily }}>
        <div style={{ height: 56, background: "#ffffff", borderBottom: "1px solid #e4e4e8", display: "flex", alignItems: "center", padding: "0 24px", gap: 28 }}>
            <span style={{ fontSize: 18, fontWeight: 600, color: "#1d1d1f", letterSpacing: "-0.01em" }}>TensorBoard</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#2997ff", borderBottom: "2px solid #2997ff", padding: "18px 0 16px" }}>SCALARS</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#8a8a92" }}>TIME SERIES</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: MonoFamily, fontSize: 12, color: "#8a8a92" }}>runs/lr-6e-4</span>
        </div>
        <div style={{ position: "absolute", left: 24, right: 24, top: 80, bottom: 24, background: "#fff", borderRadius: 12, border: "1px solid #e4e4e8", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: "#1d1d1f" }}>train/loss</span>
                <span style={{ fontSize: 13, color: "#8a8a92" }}>step {Math.round(upTo * draw)} · {lossAt(Math.max(1, Math.round(upTo * draw))).toFixed(3)}</span>
            </div>
            <div style={{ marginTop: 10 }}>
                <LossChart width={width - 48 - 40} height={height - 80 - 24 - 36 - 28 - 10} upTo={upTo} draw={draw} />
            </div>
        </div>
    </div>
);
