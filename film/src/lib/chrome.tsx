import React from "react";
import { Img } from "remotion";
import { WINDOW_H, WINDOW_W } from "./camera";

const Radius = 12;

// The capture is web contents only, so the window's macOS chrome (traffic lights, edge
// light and shadow) is drawn here. The app reserves the space for the lights itself.
const TrafficLights: React.FC<{ dim?: number }> = ({ dim = 0 }) => {
    const colors = ["#ff5f57", "#febc2e", "#28c840"];
    return (
        <div style={{ position: "absolute", left: 14, top: 14, display: "flex", gap: 8, opacity: 1 - dim * 0.55 }}>
            {colors.map((c) => (
                <div
                    key={c}
                    style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        background: c,
                        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)",
                    }}
                />
            ))}
        </div>
    );
};

export const AppWindow: React.FC<{
    src?: string;
    children?: React.ReactNode;
    shadow?: number;
    glow?: number;
}> = ({ src, children, shadow = 1, glow = 0 }) => {
    return (
        <div style={{ position: "absolute", left: 0, top: 0, width: WINDOW_W, height: WINDOW_H }}>
            <div
                style={{
                    position: "absolute",
                    inset: -120,
                    borderRadius: 200,
                    background: "radial-gradient(closest-side, rgba(77,141,255,0.22), rgba(77,141,255,0) 100%)",
                    filter: "blur(40px)",
                    opacity: glow,
                }}
            />
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: Radius,
                    overflow: "hidden",
                    background: "#0e0e0f",
                    boxShadow: [
                        "0 0 0 1px rgba(255,255,255,0.09)",
                        `0 30px 60px -10px rgba(0,0,0,${0.55 * shadow})`,
                        `0 80px 160px -20px rgba(0,0,0,${0.6 * shadow})`,
                    ].join(", "),
                }}
            >
                {src ? <Img src={src} style={{ position: "absolute", width: WINDOW_W, height: WINDOW_H }} /> : null}
                {children}
                <TrafficLights />
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: Radius,
                        pointerEvents: "none",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
                    }}
                />
            </div>
        </div>
    );
};
