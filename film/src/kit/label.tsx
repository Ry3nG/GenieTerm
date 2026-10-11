import React from "react";
import { SansFamily } from "../lib/fonts";
import { Ease, ramp, sec } from "./motion";
import { T } from "./tokens";

// The film's only annotation: one short line set in clear space, aligned to the edge of the
// thing it names. No dots, no leader lines. It arrives after the action lands and leaves
// before the next one starts.

export const LABEL_SIZE = 44;

export const Label: React.FC<{
    frame: number;
    x: number;
    y: number;
    text: string;
    sub?: string;
    from: number;
    to: number;
    align?: "left" | "center" | "right";
    size?: number;
}> = ({ frame, x, y, text, sub, from, to, align = "left", size = LABEL_SIZE }) => {
    const enter = ramp(frame, from, from + sec(0.7), Ease.enter);
    const exit = ramp(frame, to - sec(0.4), to, Ease.exit);
    const a = enter * (1 - exit);
    if (a <= 0) {
        return null;
    }
    const subIn = sub ? ramp(frame, from + sec(0.25), from + sec(0.95), Ease.enter) : 0;
    const translate = align === "center" ? "-50%" : align === "right" ? "-100%" : "0";
    return (
        <div
            style={{
                position: "absolute",
                left: x,
                top: y,
                transform: `translate(${translate}, ${(1 - enter) * 14 - exit * 10}px)`,
                textAlign: align,
                opacity: a,
                filter: `blur(${(1 - enter) * 6}px)`,
            }}
        >
            <div style={{ fontFamily: SansFamily, fontSize: size, fontWeight: 600, letterSpacing: "-0.022em", lineHeight: 1.1, color: T.fg, whiteSpace: "nowrap" }}>{text}</div>
            {sub && (
                <div
                    style={{
                        marginTop: size * 0.32,
                        fontFamily: SansFamily,
                        fontSize: size * 0.56,
                        fontWeight: 450,
                        letterSpacing: "-0.01em",
                        color: T.secondary,
                        whiteSpace: "nowrap",
                        opacity: subIn,
                    }}
                >
                    {sub}
                </div>
            )}
        </div>
    );
};
