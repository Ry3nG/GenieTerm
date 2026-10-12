import React from "react";
import { interpolate } from "remotion";
import { appleSpring } from "./motion";
import { spring } from "remotion";

export type CursorMove = { f: number; x: number; y: number; dur?: number; click?: boolean };

// Minimum-jerk position profile along a gentle arc, with a small overshoot that settles.
function minJerk(t: number) {
    return t * t * t * (10 - 15 * t + 6 * t * t);
}

export function cursorAt(moves: CursorMove[], frame: number, fps: number) {
    let x = moves[0].x;
    let y = moves[0].y;
    let press = 0;
    for (let i = 1; i < moves.length; i++) {
        const a = moves[i - 1];
        const b = moves[i];
        const dur = b.dur ?? 40;
        const start = b.f - dur;
        if (frame <= start) {
            break;
        }
        const raw = Math.min(1, (frame - start) / dur);
        const t = minJerk(raw);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // control offset perpendicular to the chord: a hand moves in arcs, not lines
        const bow = Math.sin(Math.PI * t) * len * 0.09;
        const settle = raw >= 1 ? spring({ frame: frame - b.f, fps, config: appleSpring(0.35, 0.15) }) : 1;
        const over = raw >= 1 ? (1 - settle) * 0.025 : 0;
        x = a.x + dx * (t + over) + (-dy / len) * bow;
        y = a.y + dy * (t + over) + (dx / len) * bow;
        if (b.click) {
            const since = frame - b.f;
            press = since >= 0 && since < 10 ? Math.sin((since / 10) * Math.PI) : 0;
        }
    }
    return { x, y, press };
}

export const Pointer: React.FC<{ x: number; y: number; press: number; opacity?: number; size?: number }> = ({
    x,
    y,
    press,
    opacity = 1,
    size = 22,
}) => {
    const s = 1 - press * 0.14;
    const ring = interpolate(press, [0, 1], [0, 1]);
    return (
        <div style={{ position: "absolute", left: x, top: y, opacity, pointerEvents: "none" }}>
            <div
                style={{
                    position: "absolute",
                    left: -18,
                    top: -18,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    border: "1.5px solid rgba(255,255,255,0.55)",
                    opacity: ring * 0.5,
                    transform: `scale(${0.4 + ring * 0.8})`,
                }}
            />
            <svg
                width={size}
                height={size * 1.4}
                viewBox="0 0 20 28"
                style={{ transform: `scale(${s})`, transformOrigin: "2px 2px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))" }}
            >
                <path
                    d="M2 2 L2 21.5 L6.8 17.2 L10.1 25 L13.4 23.6 L10.2 16 L16.6 16 Z"
                    fill="#111"
                    stroke="#fff"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                />
            </svg>
        </div>
    );
};
