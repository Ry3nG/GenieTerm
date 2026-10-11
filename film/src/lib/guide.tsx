import React from "react";
import { AbsoluteFill } from "remotion";
import { BASE_SCALE, type Cam } from "./camera";
import { SansFamily } from "./fonts";
import { HEIGHT, WIDTH } from "../timeline";

// Guides sit in screen space so their type stays one size however close the camera is;
// they are positioned by projecting points of the captured window through the camera.

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export function toScreen(cam: Cam, p: Pt): Pt {
    const s = BASE_SCALE * cam.z;
    return { x: WIDTH / 2 + (p.x - cam.x) * s, y: HEIGHT / 2 + (p.y - cam.y) * s };
}

export function boxToScreen(cam: Cam, b: Box): Box {
    const a = toScreen(cam, { x: b.x, y: b.y });
    const s = BASE_SCALE * cam.z;
    return { x: a.x, y: a.y, w: b.w * s, h: b.h * s };
}

const Glass = {
    background: "rgba(22,24,29,0.78)",
    border: "1px solid rgba(255,255,255,0.12)",
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
};

// A label with a dot on the thing it describes and a short leader line to a frosted pill.
export const Callout: React.FC<{
    at: Pt;
    text: string;
    side?: "left" | "right" | "up" | "down";
    reach?: number;
    show: number;
    tone?: string;
}> = ({ at, text, side = "right", reach = 70, show, tone = "#7fb2ff" }) => {
    if (show <= 0.001) {
        return null;
    }
    const dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[side];
    const line = Math.min(1, show * 1.6);
    const pill = Math.max(0, Math.min(1, (show - 0.25) / 0.75));
    const end = { x: at.x + dir[0] * reach * line, y: at.y + dir[1] * reach * line };
    const pillStyle: React.CSSProperties = {
        position: "absolute",
        left: end.x,
        top: end.y,
        transform: `translate(${side === "left" ? "-100%" : side === "right" ? "0" : "-50%"}, ${
            side === "up" ? "-100%" : side === "down" ? "0" : "-50%"
        }) translate(${dir[0] * 8}px, ${dir[1] * 8}px) translateY(${(1 - pill) * 6}px)`,
        opacity: pill,
        padding: "11px 20px",
        borderRadius: 999,
        fontFamily: SansFamily,
        fontWeight: 500,
        fontSize: 24,
        letterSpacing: "-0.005em",
        color: "rgba(255,255,255,0.92)",
        whiteSpace: "nowrap",
        ...Glass,
    };
    return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
            <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0 }}>
                <line x1={at.x} y1={at.y} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.45)" strokeWidth={1.4} />
                <circle cx={at.x} cy={at.y} r={5 * Math.min(1, show * 3)} fill={tone} />
                <circle cx={at.x} cy={at.y} r={5 + 9 * Math.min(1, show * 2)} fill="none" stroke={tone} strokeOpacity={0.35 * (1 - Math.min(1, show * 1.2))} />
            </svg>
            <div style={pillStyle}>{text}</div>
        </AbsoluteFill>
    );
};

// A rounded ring that draws itself around a control, then breathes once to invite a click.
export const FocusRing: React.FC<{ box: Box; show: number; pulse?: number; radius?: number; pad?: number }> = ({
    box,
    show,
    pulse = 0,
    radius = 10,
    pad = 6,
}) => {
    if (show <= 0.001) {
        return null;
    }
    const x = box.x - pad;
    const y = box.y - pad;
    const w = box.w + pad * 2;
    const h = box.h + pad * 2;
    const perim = 2 * (w + h);
    const grow = 1 + Math.sin(pulse * Math.PI) * 0.06;
    return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
            <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
                <g transform={`translate(${x + w / 2} ${y + h / 2}) scale(${grow}) translate(${-(x + w / 2)} ${-(y + h / 2)})`}>
                    <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        rx={radius + pad}
                        fill="none"
                        stroke="rgba(127,178,255,0.95)"
                        strokeWidth={2}
                        strokeDasharray={perim}
                        strokeDashoffset={perim * (1 - Math.min(1, show * 1.4))}
                        opacity={Math.min(1, show * 2)}
                        style={{ filter: "drop-shadow(0 0 10px rgba(77,141,255,0.7))" }}
                    />
                </g>
            </svg>
        </AbsoluteFill>
    );
};

// A soft highlighter swept under one line of text.
export const Marker: React.FC<{ box: Box; show: number; color?: string }> = ({ box, show, color = "rgba(255,206,92,0.22)" }) => {
    if (show <= 0.001) {
        return null;
    }
    return (
        <div
            style={{
                position: "absolute",
                left: box.x - 6,
                top: box.y - 3,
                width: (box.w + 12) * Math.min(1, show * 1.2),
                height: box.h + 6,
                borderRadius: 6,
                background: color,
                boxShadow: `0 0 18px ${color}`,
                mixBlendMode: "screen",
                pointerEvents: "none",
            }}
        />
    );
};

// Dims everything except one rounded region, with a feathered edge.
export const DimExcept: React.FC<{ box: Box; amount: number; radius?: number; feather?: number }> = ({
    box,
    amount,
    radius = 14,
    feather = 28,
}) => {
    if (amount <= 0.001) {
        return null;
    }
    const id = `dim${Math.round(box.x)}${Math.round(box.y)}`;
    return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
            <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0 }}>
                <defs>
                    <filter id={`${id}f`} x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation={feather / 2} />
                    </filter>
                    <mask id={`${id}m`}>
                        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="white" />
                        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={radius} fill="black" filter={`url(#${id}f)`} />
                    </mask>
                </defs>
                <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="rgba(4,5,7,1)" opacity={0.62 * amount} mask={`url(#${id}m)`} />
            </svg>
        </AbsoluteFill>
    );
};
