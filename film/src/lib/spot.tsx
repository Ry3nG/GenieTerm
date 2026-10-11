import React from "react";
import { AbsoluteFill } from "remotion";

// Darkness everywhere except a soft band of light across the middle of the frame, where the
// line being typed sits. The opening and the last command use it; it opens to full light.
export const Spot: React.FC<{ amount: number }> = ({ amount }) => {
    if (amount <= 0) {
        return null;
    }
    return (
        <AbsoluteFill
            style={{
                pointerEvents: "none",
                opacity: amount,
                background:
                    "radial-gradient(ellipse 60% 13% at 50% 50%, rgba(5,6,8,0) 0%, rgba(5,6,8,0.2) 45%, rgba(5,6,8,0.995) 100%)",
            }}
        />
    );
};
