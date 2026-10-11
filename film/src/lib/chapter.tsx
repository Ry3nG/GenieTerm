import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { SansFamily } from "./fonts";
import { Ease, ramp, springAt } from "./motion";

// The breath at the top of each chapter: the product steps back, softly out of focus, while
// the chapter's name and one plain sentence come forward. Then they make room again.
export function recede(f: number, inAt: number, outAt: number) {
    const back = f < outAt ? ramp(f, inAt - 26, inAt + 10, [0, 1], Ease.glide) : ramp(f, outAt, outAt + 46, [1, 0], Ease.glide);
    return back;
}

export const Recede: React.FC<{ amount: number; children: React.ReactNode }> = ({ amount, children }) => (
    <AbsoluteFill
        style={{
            transform: `scale(${1 - 0.06 * amount})`,
            filter: amount > 0.002 ? `blur(${9 * amount}px) brightness(${1 - 0.5 * amount})` : undefined,
        }}
    >
        {children}
    </AbsoluteFill>
);

export const ChapterTitle: React.FC<{ f: number; label: string; line: string; inAt: number; outAt: number }> = ({
    f,
    label,
    line,
    inAt,
    outAt,
}) => {
    const { fps } = useVideoConfig();
    if (f < inAt - 4 || f > outAt + 40) {
        return null;
    }
    const enterLabel = springAt(f - inAt, fps, 1.1, 0);
    const enterLine = springAt(f - inAt - 9, fps, 1.2, 0);
    const leave = ramp(f, outAt, outAt + 30, [0, 1], Ease.exit);
    const piece = (enter: number, delay: number): React.CSSProperties => {
        const l = ramp(f, outAt + delay, outAt + delay + 26, [0, 1], Ease.exit);
        return {
            opacity: Math.min(1, enter * 1.15) * (1 - l),
            filter: `blur(${(1 - enter) * 10 + l * 6}px)`,
            transform: `translateY(${(1 - enter) * 16 - l * 12}px)`,
        };
    };
    return (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - leave * 0 }}>
            <div style={{ textAlign: "center", maxWidth: 1760 }}>
                <div
                    style={{
                        fontFamily: SansFamily,
                        fontWeight: 600,
                        fontSize: 21,
                        letterSpacing: "0.26em",
                        color: "rgba(140,184,255,0.95)",
                        marginBottom: 22,
                        ...piece(enterLabel, 0),
                    }}
                >
                    {label}
                </div>
                <div
                    style={{
                        fontFamily: SansFamily,
                        fontWeight: 600,
                        fontSize: 64,
                        lineHeight: 1.08,
                        letterSpacing: "-0.022em",
                        color: "rgba(255,255,255,0.96)",
                        ...piece(enterLine, 4),
                    }}
                >
                    {line}
                </div>
            </div>
        </AbsoluteFill>
    );
};
