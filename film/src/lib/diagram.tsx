import React from "react";
import { Img } from "remotion";
import { MonoFamily, SansFamily } from "./fonts";

// Hand-built illustrations for the ideas a screen recording can't show: a laptop going to
// sleep while a server keeps working, and data travelling between them.

export const Laptop: React.FC<{
    x: number;
    y: number;
    width: number;
    lid: number;
    screen: string;
    label?: string;
    labelShow?: number;
}> = ({ x, y, width, lid, screen, label, labelShow = 1 }) => {
    const sw = width * 0.9;
    const sh = (sw * 9) / 16;
    const bezel = width * 0.016;
    const angle = -lid * 96;
    const lit = 1 - Math.min(1, lid * 1.4);
    return (
        <div style={{ position: "absolute", left: x - width / 2, top: y - sh, width, height: sh + 60, perspective: 1600 }}>
            <div
                style={{
                    position: "absolute",
                    left: (width - sw) / 2,
                    top: 0,
                    width: sw,
                    height: sh,
                    transformOrigin: "50% 100%",
                    transform: `rotateX(${angle}deg)`,
                    transformStyle: "preserve-3d",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: width * 0.022,
                        background: "#0b0c0e",
                        border: "1px solid rgba(255,255,255,0.14)",
                        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
                        backfaceVisibility: "hidden",
                        overflow: "hidden",
                    }}
                >
                    <div style={{ position: "absolute", inset: bezel, borderRadius: width * 0.008, overflow: "hidden", background: "#000" }}>
                        <Img src={screen} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: lit }} />
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                background: "linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0) 40%)",
                            }}
                        />
                    </div>
                </div>
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: width * 0.022,
                        transform: "rotateY(180deg)",
                        backfaceVisibility: "hidden",
                        background: "linear-gradient(180deg, #3a3e45, #24272c)",
                        border: "1px solid rgba(255,255,255,0.1)",
                    }}
                />
            </div>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    top: sh,
                    width,
                    height: width * 0.024,
                    borderRadius: `2px 2px ${width * 0.03}px ${width * 0.03}px`,
                    background: "linear-gradient(180deg, #4a4e56, #2a2d33)",
                    boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        left: "50%",
                        top: 0,
                        width: width * 0.14,
                        height: width * 0.008,
                        transform: "translateX(-50%)",
                        borderRadius: "0 0 6px 6px",
                        background: "rgba(0,0,0,0.35)",
                    }}
                />
            </div>
            {label ? <NodeLabel x={width / 2} y={sh + width * 0.024 + 34} text={label} show={labelShow} /> : null}
        </div>
    );
};

export const NodeLabel: React.FC<{ x: number; y: number; text: string; sub?: string; show?: number }> = ({ x, y, text, sub, show = 1 }) => (
    <div
        style={{
            position: "absolute",
            left: x,
            top: y,
            transform: `translate(-50%, ${(1 - show) * 8}px)`,
            opacity: show,
            textAlign: "center",
            whiteSpace: "nowrap",
        }}
    >
        <div style={{ fontFamily: SansFamily, fontWeight: 600, fontSize: 24, color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em" }}>{text}</div>
        {sub ? <div style={{ fontFamily: SansFamily, fontWeight: 450, fontSize: 18, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{sub}</div> : null}
    </div>
);

export const Server: React.FC<{
    x: number;
    y: number;
    height: number;
    frame: number;
    epoch: number;
    total: number;
    busy: number;
    label?: string;
    sub?: string;
    labelShow?: number;
}> = ({ x, y, height, frame, epoch, total, busy, label, sub, labelShow = 1 }) => {
    const w = height * 0.62;
    const bays = 4;
    return (
        <div style={{ position: "absolute", left: x - w / 2, top: y - height, width: w, height }}>
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: height * 0.06,
                    background: "linear-gradient(180deg, #23262d 0%, #15171b 100%)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    boxShadow: "0 40px 90px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
                    overflow: "hidden",
                }}
            >
                {Array.from({ length: bays }).map((_, i) => {
                    const blink = busy > 0 ? 0.35 + 0.65 * Math.max(0, Math.sin(frame * (0.31 + i * 0.07) + i * 1.9)) : 0.15;
                    return (
                        <div
                            key={i}
                            style={{
                                position: "absolute",
                                left: height * 0.06,
                                right: height * 0.06,
                                top: height * (0.08 + i * 0.105),
                                height: height * 0.08,
                                borderRadius: height * 0.02,
                                background: "rgba(255,255,255,0.035)",
                                border: "1px solid rgba(255,255,255,0.05)",
                            }}
                        >
                            <div
                                style={{
                                    position: "absolute",
                                    right: height * 0.025,
                                    top: "50%",
                                    width: height * 0.018,
                                    height: height * 0.018,
                                    borderRadius: 99,
                                    transform: "translateY(-50%)",
                                    background: `rgba(52,211,153,${blink * (0.4 + 0.6 * busy)})`,
                                    boxShadow: `0 0 ${10 * blink * busy}px rgba(52,211,153,0.9)`,
                                }}
                            />
                            {Array.from({ length: 6 }).map((__, k) => (
                                <div
                                    key={k}
                                    style={{
                                        position: "absolute",
                                        left: height * (0.025 + k * 0.03),
                                        top: "30%",
                                        width: height * 0.012,
                                        height: "40%",
                                        borderRadius: 2,
                                        background: "rgba(255,255,255,0.08)",
                                    }}
                                />
                            ))}
                        </div>
                    );
                })}
                <div
                    style={{
                        position: "absolute",
                        left: height * 0.06,
                        right: height * 0.06,
                        bottom: height * 0.07,
                        height: height * 0.36,
                        borderRadius: height * 0.03,
                        background: "rgba(0,0,0,0.45)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        padding: height * 0.04,
                        boxSizing: "border-box",
                    }}
                >
                    <div style={{ fontFamily: SansFamily, fontSize: height * 0.04, color: "rgba(255,255,255,0.5)", letterSpacing: "0.12em" }}>TRAINING</div>
                    <div style={{ fontFamily: MonoFamily, fontSize: height * 0.085, color: "rgba(255,255,255,0.95)", marginTop: height * 0.02 }}>
                        epoch <span style={{ color: "#8cc4ff" }}>{String(Math.floor(epoch)).padStart(2, " ")}</span>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>/{total}</span>
                    </div>
                    <div style={{ marginTop: height * 0.035, height: height * 0.014, borderRadius: 99, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
                        <div style={{ width: `${(epoch / total) * 100}%`, height: "100%", borderRadius: 99, background: "linear-gradient(90deg, #4d8dff, #8cc4ff)" }} />
                    </div>
                </div>
            </div>
            {label ? <NodeLabel x={w / 2} y={height + 34} text={label} sub={sub} show={labelShow} /> : null}
        </div>
    );
};

// A link between two points. `live` lights it and runs data along it from b toward a;
// `rush` crowds the pulses together for output arriving all at once.
export const Link: React.FC<{
    a: { x: number; y: number };
    b: { x: number; y: number };
    frame: number;
    live: number;
    rush?: number;
    show?: number;
}> = ({ a, b, frame, live, rush = 0, show = 1 }) => {
    const mx = (a.x + b.x) / 2;
    const my = Math.min(a.y, b.y) - 70;
    const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
    const point = (t: number) => ({
        x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x,
        y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y,
    });
    const count = Math.round(6 + rush * 18);
    const speed = 0.012 + rush * 0.03;
    const pulses = Array.from({ length: count }).map((_, i) => {
        const t = 1 - ((frame * speed + i / count) % 1);
        return { ...point(t), t };
    });
    return (
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible", opacity: show }}>
            <defs>
                <linearGradient id="linkGrad" x1={a.x} y1={a.y} x2={b.x} y2={b.y} gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#8cc4ff" />
                    <stop offset="1" stopColor="#4d8dff" />
                </linearGradient>
            </defs>
            <path d={d} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={2} strokeDasharray={live < 0.5 ? "6 10" : undefined} />
            <path d={d} fill="none" stroke="url(#linkGrad)" strokeWidth={2.5} opacity={0.55 * live} style={{ filter: "drop-shadow(0 0 8px rgba(77,141,255,0.8))" }} />
            {pulses.map((p, i) => (
                <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={3.2 + rush * 1.5}
                    fill="#cfe4ff"
                    opacity={live * Math.sin(p.t * Math.PI) * 0.95}
                    style={{ filter: "drop-shadow(0 0 6px rgba(140,196,255,1))" }}
                />
            ))}
        </svg>
    );
};

export const Moon: React.FC<{ x: number; y: number; show: number }> = ({ x, y, show }) => (
    <svg width={60} height={60} viewBox="0 0 24 24" style={{ position: "absolute", left: x - 30, top: y - 30, opacity: show, transform: `translateY(${(1 - show) * 10}px)` }}>
        <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="rgba(255,255,255,0.85)" />
    </svg>
);
