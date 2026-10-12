import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Chapters } from "../timeline";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { indexAtTime, scene } from "../lib/frames";
import { SansFamily } from "../lib/fonts";
import { Ease, ramp, springAt } from "../lib/motion";
import { HeroWindow } from "./hero";
import { breathe } from "./shell";

// One line on black, then the product rises out of the dark: training on the left, the GPU it
// is using on the right, the project's files below.
export const Intro: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("c_hero");
    const len = Chapters.intro.to - Chapters.intro.from;
    const idx = indexAtTime(s, (f / fps) * 1000 * 0.9);
    const keys: CamKey[] = [
        { f: 0, ...Home, y: 560, z: 0.62, rx: 20, ry: -6 },
        { f: 120, ...Home, y: 560, z: 0.64, rx: 19, ry: -6 },
        { f: 250, ...Home, y: 470, z: 0.86, rx: 5, ry: -2, ease: Ease.glide },
        { f: len, ...Home, y: 455, z: 0.92, rx: 1.5, ry: -0.6, ease: Ease.linear },
    ];
    const cam = breathe(cameraAt(keys, f), f);
    const rise = springAt(f - 110, fps, 1.6, 0);
    const lineIn = springAt(f - 18, fps, 1.2, 0);
    const lineOut = ramp(f, 112, 150, [0, 1], Ease.exit);
    const fadeOut = ramp(f, len - 18, len, [1, 0], Ease.glide);
    return (
        <AbsoluteFill style={{ opacity: fadeOut }}>
            <Backdrop lift={rise} />
            <AbsoluteFill style={{ opacity: rise, filter: `blur(${(1 - rise) * 14}px)` }}>
                <Stage cam={cam}>
                    <HeroWindow idx={idx} f={f} glow={0.6 * rise} />
                </Stage>
            </AbsoluteFill>
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <div
                    style={{
                        fontFamily: SansFamily,
                        fontWeight: 600,
                        fontSize: 66,
                        letterSpacing: "-0.024em",
                        color: "rgba(255,255,255,0.96)",
                        opacity: Math.min(1, lineIn * 1.1) * (1 - lineOut),
                        filter: `blur(${(1 - lineIn) * 10 + lineOut * 8}px)`,
                        transform: `translateY(${(1 - lineIn) * 16 - lineOut * 14}px)`,
                    }}
                >
                    The terminal for people who live in SSH.
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};
