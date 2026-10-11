import React from "react";
import { Img } from "remotion";
import { WINDOW_H, WINDOW_W } from "./camera";
import type { Rect } from "./lift";

// Output that arrives all at once (a reconnect replaying what was missed) slides up into
// place for a few frames with a vertical smear, built from the arriving frame's own pixels.
export const Streak: React.FC<{ src: string; rect: Rect; progress: number; travel: number; bg: string }> = ({
    src,
    rect,
    progress,
    travel,
    bg,
}) => {
    if (progress <= 0 || progress >= 1) {
        return null;
    }
    const ease = 1 - Math.pow(1 - progress, 3);
    const offset = (1 - ease) * travel;
    const ghosts = [0, 0.25, 0.5, 0.75];
    return (
        <div
            style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                overflow: "hidden",
                background: bg,
            }}
        >
            {ghosts.map((g, i) => (
                <Img
                    key={i}
                    src={src}
                    style={{
                        position: "absolute",
                        left: -rect.x,
                        top: -rect.y + offset + g * travel * 0.18 * (1 - ease),
                        width: WINDOW_W,
                        height: WINDOW_H,
                        opacity: i === 0 ? 1 : 0.28 * (1 - ease),
                    }}
                />
            ))}
        </div>
    );
};
