import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { SansFamily } from "../lib/fonts";
import { Ease, Spring, mix, ramp, springAt } from "../kit/motion";
import { FRAME_W, World, toScreen } from "../kit/stage";
import { T } from "../kit/tokens";
import { CELL_H, CELL_W } from "../kit/tokens";
import { ColdCaret } from "./ColdOpen";
import { LocalPrompt, Workspace, termCaretWorld } from "./workspace";

// The name, typed by the caret that survived the cold open. Then the caret drops into the
// GenieTerm window rising out of the dark, and becomes its terminal's caret.

export const TITLE_SIZE = 96;
const NAME = "GenieTerm";
const LINE = "The terminal for machines you don't sit in front of.";

// The window's camera as the title hands over to "connect".
export const WindowRise = {
    from: { x: 800, y: 470, zoom: 0.8 },
    to: { x: 800, y: 450, zoom: 0.92 },
};

export const TitleTimes = { move: 0, type: 46, line: 140, out: 222, rise: [250, 320] as const };

// Advance widths of each prefix of the name (Inter 600, 96 px, -0.03em, kerning off),
// measured from the font file so the caret rides the text exactly.
const PREFIX_W = [0, 67.6, 117.8, 169.9, 189.3, 239.6, 296.9, 347.1, 378.4, 458.9];
const NAME_W = PREFIX_W[PREFIX_W.length - 1];

export const Title: React.FC = () => {
    const f = useCurrentFrame();
    const Tt = TitleTimes;

    const nameX = FRAME_W / 2 - (NAME_W + TITLE_SIZE * 0.5) / 2;
    const nameY = 430;
    const typed = Math.max(0, Math.min(NAME.length, Math.floor((f - Tt.type) / 5)));
    const caretH = TITLE_SIZE * 0.74;

    // caret: from where the terminal left it to the head of the name, then riding the text
    const travel = springAt(f, Tt.move, Spring.large);
    const textEnd = nameX + PREFIX_W[typed];
    const titleCaret = {
        x: mix(ColdCaret.x, nameX + 4, travel) + (textEnd - nameX),
        y: mix(ColdCaret.y, nameY + TITLE_SIZE * 0.17, travel),
        w: mix(ColdCaret.w, caretH * 0.5, travel),
        h: mix(ColdCaret.h, caretH, travel),
    };
    const blue = ramp(f, 8, 40, Ease.move);
    const blink = f > Tt.type + NAME.length * 5 + 20 && f < Tt.out ? (Math.floor((f - Tt.type) / 32) % 2 === 0 ? 1 : 0.15) : 1;

    // the window rises; the caret drops into its terminal
    const rise = ramp(f, Tt.rise[0], Tt.rise[1], Ease.camera);
    const cam = {
        x: mix(WindowRise.from.x, WindowRise.to.x, rise),
        y: mix(WindowRise.from.y, WindowRise.to.y, rise),
        zoom: mix(WindowRise.from.zoom, WindowRise.to.zoom, rise),
    };
    const world = termCaretWorld(LocalPrompt.length);
    const dest = toScreen(cam, world.x, world.y);
    const drop = springAt(f, Tt.rise[0], Spring.large);
    const caret = {
        x: mix(titleCaret.x, dest.x, drop),
        y: mix(titleCaret.y, dest.y, drop),
        w: mix(titleCaret.w, CELL_W * cam.zoom, drop),
        h: mix(titleCaret.h, (CELL_H - 2) * cam.zoom, drop),
    };
    const caretColor = drop > 0.5 ? `rgba(232,232,232,1)` : `rgb(${mix(208, 41, blue)}, ${mix(208, 151, blue)}, ${mix(208, 255, blue)})`;

    const textOut = ramp(f, Tt.out, Tt.out + 40, Ease.exit);
    const lineIn = ramp(f, Tt.line, Tt.line + 50, Ease.enter);
    const windowIn = ramp(f, Tt.rise[0], Tt.rise[0] + 50, Ease.out);
    return (
        <AbsoluteFill style={{ background: "#000" }}>
            {windowIn > 0 && (
                <AbsoluteFill style={{ opacity: windowIn, filter: `blur(${(1 - windowIn) * 14}px)` }}>
                    <World cam={cam}>
                        <Workspace stage="local" frame={f} caret={false} />
                    </World>
                </AbsoluteFill>
            )}
            <div
                style={{
                    position: "absolute",
                    left: nameX,
                    top: nameY,
                    fontFamily: SansFamily,
                    fontWeight: 600,
                    fontSize: TITLE_SIZE,
                    letterSpacing: "-0.03em",
                    fontKerning: "none",
                    lineHeight: 1,
                    color: T.fg,
                    whiteSpace: "pre",
                    opacity: 1 - textOut,
                    transform: `translateY(${-textOut * 24}px) scale(${1 - textOut * 0.03})`,
                    filter: `blur(${textOut * 8}px)`,
                }}
            >
                {NAME.slice(0, typed)}
            </div>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: nameY + TITLE_SIZE + 34,
                    textAlign: "center",
                    fontFamily: SansFamily,
                    fontWeight: 450,
                    fontSize: 34,
                    letterSpacing: "-0.012em",
                    color: T.secondary,
                    opacity: lineIn * (1 - textOut),
                    transform: `translateY(${(1 - lineIn) * 14 - textOut * 24}px)`,
                    filter: `blur(${(1 - lineIn) * 6 + textOut * 8}px)`,
                }}
            >
                {LINE}
            </div>
            <div style={{ position: "absolute", left: caret.x, top: caret.y, width: caret.w, height: caret.h, background: caretColor, opacity: drop > 0 ? 1 : blink }} />
        </AbsoluteFill>
    );
};
