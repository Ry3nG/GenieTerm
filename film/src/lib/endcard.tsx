import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { MonoFamily, SansFamily } from "./fonts";
import { Ease, ramp, springAt } from "./motion";

// The sign-off: the name, the line, where it runs and where to get it.
export const EndCard: React.FC<{ start: number; tagline?: string }> = ({ start, tagline }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const f = frame - start;
    const logoIn = springAt(f, fps, 1.6, 0);
    const logoOpacity = ramp(f, 0, 40, [0, 1], Ease.reveal);
    const wordIn = springAt(f, fps, 1.4, 0, 18);
    const wordOpacity = ramp(f, 18, 60, [0, 1], Ease.reveal);
    const subOpacity = ramp(f, 54, 96, [0, 1], Ease.reveal);
    const urlOpacity = ramp(f, 78, 120, [0, 1], Ease.reveal);
    const sweep = ramp(f, 30, 110, [-0.6, 1.6], Ease.glide);
    const settle = 1 + (1 - logoIn) * 0.06 + f * 0.00008;
    return (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${settle})` }}>
                <div style={{ position: "relative", width: 168, height: 168, opacity: logoOpacity, transform: `translateY(${(1 - logoIn) * 18}px)` }}>
                    <Img src={staticFile("brand/genieterm-logo-1024.png")} style={{ width: 168, height: 168 }} />
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: 38,
                            background: `linear-gradient(115deg, rgba(255,255,255,0) ${(sweep - 0.12) * 100}%, rgba(255,255,255,0.22) ${sweep * 100}%, rgba(255,255,255,0) ${(sweep + 0.12) * 100}%)`,
                            mixBlendMode: "overlay",
                        }}
                    />
                </div>
                <div
                    style={{
                        marginTop: 42,
                        fontFamily: SansFamily,
                        fontWeight: 600,
                        fontSize: 92,
                        letterSpacing: "-0.025em",
                        color: "rgba(255,255,255,0.95)",
                        opacity: wordOpacity,
                        transform: `translateY(${(1 - wordIn) * 14}px)`,
                    }}
                >
                    GenieTerm
                </div>
                {tagline ? (
                    <div
                        style={{
                            marginTop: 14,
                            fontFamily: SansFamily,
                            fontWeight: 500,
                            fontSize: 34,
                            letterSpacing: "-0.012em",
                            color: "rgba(255,255,255,0.78)",
                            opacity: ramp(f, 36, 80, [0, 1], Ease.reveal),
                        }}
                    >
                        {tagline}
                    </div>
                ) : null}
                <div
                    style={{
                        marginTop: tagline ? 30 : 18,
                        fontFamily: SansFamily,
                        fontWeight: 450,
                        fontSize: 26,
                        letterSpacing: "0.01em",
                        color: "rgba(255,255,255,0.58)",
                        opacity: subOpacity,
                    }}
                >
                    Free and open source · macOS · Linux · Windows
                </div>
                <div
                    style={{
                        marginTop: 34,
                        fontFamily: MonoFamily,
                        fontSize: 24,
                        color: "rgba(255,255,255,0.42)",
                        opacity: urlOpacity,
                    }}
                >
                    github.com/Ry3nG/GenieTerm
                </div>
            </div>
        </AbsoluteFill>
    );
};
