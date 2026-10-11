import React from "react";
import { Img } from "remotion";
import { WINDOW_H, WINDOW_W } from "./camera";

export type Rect = { x: number; y: number; w: number; h: number };

// Lifts one region of the capture off the window as its own layer: same pixels, raised
// toward the camera with a shadow, while the rest of the window dims. An exploded view of
// a real screen, not a mock-up.
export const Lift: React.FC<{
    src: string;
    rect: Rect;
    amount: number;
    radius?: number;
    dim?: number;
}> = ({ src, rect, amount, radius = 10, dim = 0.45 }) => {
    if (amount <= 0) {
        return null;
    }
    const scale = 1 + 0.035 * amount;
    const rise = -6 * amount;
    return (
        <>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: WINDOW_W,
                    height: WINDOW_H,
                    background: `rgba(0,0,0,${dim * amount})`,
                    borderRadius: 12,
                }}
            />
            <div
                style={{
                    position: "absolute",
                    left: rect.x,
                    top: rect.y,
                    width: rect.w,
                    height: rect.h,
                    borderRadius: radius,
                    overflow: "hidden",
                    transform: `translateY(${rise}px) scale(${scale})`,
                    transformOrigin: "50% 50%",
                    boxShadow: [
                        `0 0 0 1px rgba(255,255,255,${0.1 * amount})`,
                        `0 ${18 * amount}px ${48 * amount}px rgba(0,0,0,${0.55 * amount})`,
                        `0 0 ${60 * amount}px rgba(77,141,255,${0.12 * amount})`,
                    ].join(", "),
                }}
            >
                <Img
                    src={src}
                    style={{ position: "absolute", left: -rect.x, top: -rect.y, width: WINDOW_W, height: WINDOW_H }}
                />
            </div>
        </>
    );
};

// A soft band of light that crosses a region once. Used at most twice in the film.
export const Sweep: React.FC<{ rect: Rect; progress: number; radius?: number }> = ({ rect, progress, radius = 10 }) => {
    if (progress <= 0 || progress >= 1) {
        return null;
    }
    const p = -30 + progress * 160;
    return (
        <div
            style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                borderRadius: radius,
                overflow: "hidden",
                pointerEvents: "none",
                mixBlendMode: "screen",
                background: `linear-gradient(105deg, rgba(255,255,255,0) ${p - 18}%, rgba(255,255,255,0.16) ${p}%, rgba(255,255,255,0) ${p + 18}%)`,
            }}
        />
    );
};
