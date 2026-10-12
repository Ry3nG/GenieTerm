import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { SansFamily } from "../lib/fonts";
import { Ease, ramp } from "../kit/motion";
import { T } from "../kit/tokens";

// A chapter card: one plain sentence on black, typed by the same accent caret as the title.
// The caret leads; the words follow it.

const SIZE = 68;

export const Card: React.FC<{ text: string; length: number }> = ({ text, length }) => {
    const f = useCurrentFrame();
    const start = 12;
    const perChar = 2.4;
    const typed = Math.max(0, Math.min(text.length, Math.floor((f - start) / perChar)));
    const done = start + text.length * perChar;
    const blink = f < done + 10 ? 1 : Math.floor((f - done) / 30) % 2 === 0 ? 1 : 0.15;
    const appear = ramp(f, 0, 12, Ease.out);
    const exit = ramp(f, length - 26, length - 2, Ease.glide);
    return (
        <AbsoluteFill style={{ background: "#000", alignItems: "center", justifyContent: "center" }}>
            <div
                style={{
                    position: "relative",
                    fontFamily: SansFamily,
                    fontWeight: 600,
                    fontSize: SIZE,
                    letterSpacing: "-0.028em",
                    lineHeight: 1,
                    color: T.fg,
                    whiteSpace: "pre",
                    opacity: 1 - exit,
                    transform: `translateY(${-exit * 18}px)`,
                    filter: `blur(${exit * 8}px)`,
                }}
            >
                {/* the full sentence lays out invisibly so typing never shifts the line */}
                <span style={{ visibility: "hidden" }}>{text}</span>
                <span style={{ position: "absolute", left: 0, top: 0 }}>
                    {text.slice(0, typed)}
                    <span
                        style={{
                            display: "inline-block",
                            width: SIZE * 0.37,
                            height: SIZE * 0.74,
                            marginLeft: SIZE * 0.06,
                            verticalAlign: "-0.06em",
                            background: T.accent,
                            opacity: appear * blink,
                        }}
                    />
                </span>
            </div>
        </AbsoluteFill>
    );
};
