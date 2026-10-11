import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Outro as O } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { EndCard } from "../lib/endcard";
import { indexAtTime, scene } from "../lib/frames";
import { Ease, ramp } from "../lib/motion";
import { HeroWindow } from "./hero";
import { breathe } from "./shell";

// Everything at once, one last time, then the name.
export const Outro: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("c_hero");
    const idx = indexAtTime(s, 1500 + (f / fps) * 1000);
    const keys: CamKey[] = [
        { f: 0, ...Home, z: 1.18, y: 430 },
        { f: O.card - 20, ...Home, z: 0.9, y: 455, rx: 4, ry: -3, ease: Ease.glide },
        { f: O.card + 30, ...Home, z: 0.7, y: 470, rx: 10, ry: -6, ease: Ease.exit },
    ];
    const cam = breathe(cameraAt(keys, f), f);
    const fadeIn = ramp(f, 0, 22, [0, 1], Ease.glide);
    const windowOut = ramp(f, O.card - 40, O.card + 10, [1, 0], Ease.glide);
    return (
        <AbsoluteFill style={{ opacity: fadeIn }}>
            <Backdrop />
            <AbsoluteFill style={{ opacity: windowOut, filter: `blur(${(1 - windowOut) * 12}px)` }}>
                <Stage cam={cam}>
                    <HeroWindow idx={idx} f={f} glow={0.6} />
                </Stage>
            </AbsoluteFill>
            {f >= O.card - 10 ? <EndCard start={O.card} tagline="The terminal for people who live in SSH." /> : null}
        </AbsoluteFill>
    );
};
