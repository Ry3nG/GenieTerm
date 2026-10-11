import React from "react";
import { staticFile } from "remotion";
import { Captures, type CaptureScene } from "../captures.generated";
import { AppWindow } from "./chrome";
import { MonoFamily } from "./fonts";

export function scene(name: string): CaptureScene {
    const s = Captures[name];
    if (!s) {
        throw new Error(`no capture scene ${name}`);
    }
    return s;
}

export function frameSrc(s: CaptureScene, idx: number): string {
    const i = Math.max(0, Math.min(s.frames.length - 1, Math.floor(idx)));
    return staticFile(`captures/${s.name}/${s.frames[i].file}`);
}

// Index of the last capture taken at or before `ms` into the scene.
export function indexAtTime(s: CaptureScene, ms: number): number {
    let lo = 0;
    let hi = s.frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (s.frames[mid].t <= ms) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}

export function markIndex(s: CaptureScene, mark: string): number {
    const v = s.marks[mark];
    if (typeof v !== "number") {
        throw new Error(`scene ${s.name} has no mark ${mark}`);
    }
    return v;
}

export const CaptureWindow: React.FC<{
    scene: CaptureScene;
    index: number;
    glow?: number;
    children?: React.ReactNode;
}> = ({ scene: s, index, glow, children }) => (
    <AppWindow src={frameSrc(s, index)} glow={glow}>
        {children}
    </AppWindow>
);

export type TermGeometry = { cellW: number; cellH: number; x: number; y: number; fontSize: number };
export type Span = { text: string; color: string; bold?: boolean };

// Vector copy of one terminal row, drawn cell by cell on the capture's own grid so it lines
// up with the raster exactly. Used where the camera is closer than the capture's density.
export const TermRow: React.FC<{
    geo: TermGeometry;
    row: number;
    col?: number;
    spans: Span[];
    bg: string;
    cover?: number;
    caret?: { col: number; color: string; on: boolean };
    opacity?: number;
}> = ({ geo, row, col = 0, spans, bg, cover = 0, caret, opacity = 1 }) => {
    const cells: React.ReactNode[] = [];
    let c = col;
    for (const span of spans) {
        for (const ch of span.text) {
            cells.push(
                <span
                    key={c}
                    style={{
                        position: "absolute",
                        left: c * geo.cellW,
                        top: 0,
                        width: geo.cellW,
                        height: geo.cellH,
                        lineHeight: `${geo.cellH}px`,
                        color: span.color,
                        fontWeight: span.bold ? 700 : 400,
                        textAlign: "center",
                    }}
                >
                    {ch === " " ? " " : ch}
                </span>
            );
            c++;
        }
    }
    return (
        <div
            style={{
                position: "absolute",
                left: geo.x,
                top: geo.y + row * geo.cellH,
                height: geo.cellH,
                width: 4000,
                fontFamily: MonoFamily,
                fontSize: geo.fontSize,
                opacity,
            }}
        >
            {cover > 0 ? (
                <div style={{ position: "absolute", left: -2, top: -2, width: cover * geo.cellW + 4, height: geo.cellH + 4, background: bg }} />
            ) : null}
            {cells}
            {caret?.on ? (
                <div
                    style={{
                        position: "absolute",
                        left: caret.col * geo.cellW,
                        top: 0,
                        width: geo.cellW,
                        height: geo.cellH,
                        background: caret.color,
                    }}
                />
            ) : null}
        </div>
    );
};
