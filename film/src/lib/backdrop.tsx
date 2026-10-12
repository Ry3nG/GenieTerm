import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { drift } from "./motion";

// Near-black, never pure black: a cool lift behind the window, a vignette, and animated
// grain that also dithers the dark gradients so the encode doesn't band.
export const Backdrop: React.FC<{ lift?: number; hue?: number }> = ({ lift = 1, hue = 220 }) => {
    const frame = useCurrentFrame();
    const breathe = 1 + drift(frame, 2, 240) * 0.03;
    return (
        <AbsoluteFill style={{ background: "#08090b" }}>
            <AbsoluteFill
                style={{
                    background: `radial-gradient(60% 55% at 50% 46%, hsla(${hue}, 22%, 13%, ${0.95 * lift}) 0%, hsla(${hue}, 20%, 8%, ${0.6 * lift}) 45%, rgba(8,9,11,0) 80%)`,
                    transform: `scale(${breathe})`,
                }}
            />
        </AbsoluteFill>
    );
};

export const Vignette: React.FC<{ amount?: number }> = ({ amount = 0.55 }) => (
    <AbsoluteFill
        style={{
            pointerEvents: "none",
            background: `radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,${amount}) 100%)`,
        }}
    />
);

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.05 }) => {
    const frame = useCurrentFrame();
    return (
        <AbsoluteFill style={{ pointerEvents: "none", opacity, mixBlendMode: "overlay" }}>
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                <filter id={`g${frame % 8}`}>
                    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 97} stitchTiles="stitch" />
                    <feColorMatrix type="saturate" values="0" />
                </filter>
                <rect width="100%" height="100%" filter={`url(#g${frame % 8})`} />
            </svg>
        </AbsoluteFill>
    );
};
