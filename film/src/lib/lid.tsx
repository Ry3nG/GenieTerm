import React from "react";
import { AbsoluteFill } from "remotion";

// A laptop lid seen from the keyboard: the picture hinges at its bottom edge and folds
// toward the viewer, and the light falls off toward the top as it closes.
export const Lid: React.FC<{ closed: number; children: React.ReactNode }> = ({ closed, children }) => {
    const angle = -closed * 92;
    const dark = Math.min(1, closed * 1.25);
    return (
        <AbsoluteFill style={{ perspective: 1500, perspectiveOrigin: "50% 100%" }}>
            <AbsoluteFill
                style={{
                    transformOrigin: "50% 100%",
                    transform: `rotateX(${angle}deg)`,
                    backfaceVisibility: "hidden",
                }}
            >
                {children}
                <AbsoluteFill
                    style={{
                        background: `linear-gradient(to bottom, rgba(0,0,0,${dark}) 0%, rgba(0,0,0,${dark * 0.8}) 60%, rgba(0,0,0,${dark * 0.55}) 100%)`,
                    }}
                />
            </AbsoluteFill>
            <AbsoluteFill style={{ background: "black", opacity: Math.max(0, (closed - 0.82) / 0.18) }} />
        </AbsoluteFill>
    );
};
