import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Grain } from "../lib/backdrop";
import { MonoFamily, SansFamily } from "../lib/fonts";
import { Spring, type SpringCfg, drift, springAt } from "./motion";
import { T } from "./tokens";

export const FRAME_W = 1920;
export const FRAME_H = 1080;

// A camera looks at a point of the world (the app window's CSS pixels) and keeps it centred.
// rx/ry tilt the world plane for the establishing shots; zoom is relative to the window
// filling the frame with a calm margin at 1.
export type Cam = { x: number; y: number; zoom: number; rx?: number; ry?: number; rz?: number };

// Every shot drifts a little, so a hold is never a freeze.
export function withDrift(cam: Cam, frame: number, amount = 1): Cam {
    return {
        ...cam,
        x: cam.x + drift(frame, 1, 600) * 6 * amount / cam.zoom,
        y: cam.y + drift(frame, 4, 700) * 4 * amount / cam.zoom,
        zoom: cam.zoom * (1 + drift(frame, 7, 900) * 0.006 * amount),
    };
}

export function worldTransform(cam: Cam): string {
    return [
        `translate(${FRAME_W / 2}px, ${FRAME_H / 2}px)`,
        `rotateX(${cam.rx ?? 0}deg)`,
        `rotateY(${cam.ry ?? 0}deg)`,
        `rotateZ(${cam.rz ?? 0}deg)`,
        `scale(${cam.zoom})`,
        `translate(${-cam.x}px, ${-cam.y}px)`,
    ].join(" ");
}

// Screen position of a world point under a flat (untilted) camera, for text set beside UI.
export function toScreen(cam: Cam, x: number, y: number) {
    return { x: FRAME_W / 2 + (x - cam.x) * cam.zoom, y: FRAME_H / 2 + (y - cam.y) * cam.zoom };
}

export const Studio: React.FC<{ light?: number; children?: React.ReactNode }> = ({ light = 1, children }) => {
    const frame = useCurrentFrame();
    const b = 1 + drift(frame, 2, 300) * 0.02;
    return (
        <AbsoluteFill style={{ background: "#070708" }}>
            <AbsoluteFill
                style={{
                    background: `radial-gradient(70% 60% at 50% 38%, rgba(46,52,64,${0.55 * light}) 0%, rgba(22,24,30,${0.5 * light}) 42%, rgba(7,7,8,0) 78%)`,
                    transform: `scale(${b})`,
                }}
            />
            {children}
        </AbsoluteFill>
    );
};

export const World: React.FC<{ cam: Cam; children: React.ReactNode; perspective?: number }> = ({ cam, children, perspective = 2600 }) => (
    <AbsoluteFill style={{ perspective, perspectiveOrigin: "50% 50%" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transformOrigin: "0 0", transform: worldTransform(cam), transformStyle: "preserve-3d" }}>
            {children}
        </div>
    </AbsoluteFill>
);

// Depth of field for UI regions that aren't the subject: soften, darken, sink slightly.
export function recede(amount: number): React.CSSProperties {
    if (amount <= 0.001) {
        return {};
    }
    return { filter: `blur(${amount * 7}px) brightness(${1 - amount * 0.42})` };
}

export const FilmGrain: React.FC = () => <Grain opacity={0.045} />;

// A block caret like the terminal's, used on the chapter cards.
export const Caret: React.FC<{ on: number; h: number; color?: string }> = ({ on, h, color = T.accent }) => (
    <span style={{ display: "inline-block", width: h * 0.52, height: h, background: color, opacity: on, verticalAlign: "-0.14em", marginLeft: h * 0.12 }} />
);

export const cardText = (size: number, color: string = T.fg): React.CSSProperties => ({
    fontFamily: MonoFamily,
    fontSize: size,
    color,
    whiteSpace: "pre",
    letterSpacing: "-0.01em",
});

export const headline = (size: number, weight = 600, color: string = T.fg): React.CSSProperties => ({
    fontFamily: SansFamily,
    fontSize: size,
    fontWeight: weight,
    color,
    letterSpacing: "-0.022em",
    lineHeight: 1.08,
    whiteSpace: "nowrap",
});

// A camera path as additive springs: each key adds its move on top of whatever is still in
// flight, so retargeting mid-move carries velocity instead of stopping. Zoom moves in log
// space so pushes feel even.
export type CamKey = { at: number; x: number; y: number; zoom: number; cfg?: SpringCfg };

export function camPath(frame: number, keys: CamKey[], cfg: SpringCfg = Spring.camera): Cam {
    let x = keys[0].x;
    let y = keys[0].y;
    let lz = Math.log(keys[0].zoom);
    for (let i = 1; i < keys.length; i++) {
        const k = keys[i];
        const p = keys[i - 1];
        const s = springAt(frame, k.at, k.cfg ?? cfg);
        x += (k.x - p.x) * s;
        y += (k.y - p.y) * s;
        lz += (Math.log(k.zoom) - Math.log(p.zoom)) * s;
    }
    return { x, y, zoom: Math.exp(lz) };
}
