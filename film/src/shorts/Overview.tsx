import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { EndCard } from "../lib/endcard";
import { SansFamily, loadFonts } from "../lib/fonts";
import { Ease, ramp } from "../kit/motion";
import { FilmGrain } from "../kit/stage";
import { T } from "../kit/tokens";
import { A, Ai } from "../v3/Ai";
import { Card } from "../v3/Card";
import { H, HostPorts } from "../v3/HostPorts";
import { AgentAway, G } from "./AgentAway";
import { F, FilesShort } from "./FilesShort";
import { ColdOpen, coldCaret } from "../v3/ColdOpen";
import { Spring, mix, springAt } from "../kit/motion";

loadFonts();

// The overview: the name, then the best stretch of each short behind its own hook card.
// Excerpts are the shorts' scenes themselves, entered part-way and faded at both ends.

export type Excerpt = { id: string; hook: string; scene: React.FC; from: number; to: number };

export const Excerpts: Excerpt[] = [
    { id: "agent", hook: "Close the lid. Your agent keeps working.", scene: AgentAway, from: G.handoff - 100, to: G.label + 170 },
    { id: "files", hook: "The server's files, right here.", scene: FilesShort, from: F.pick - 40, to: F.label + 150 },
    { id: "host", hook: "See the whole machine.", scene: HostPorts, from: H.rail - 30, to: H.end },
    { id: "ai", hook: "Stuck? Ask the AI you already use.", scene: Ai, from: A.failed - 40, to: A.end },
];

export const COLD = 640;
export const TITLE = 300;
export const CARD = 160;
export const OUTRO = 300;
const FADE = 24;

export function overviewLayout() {
    let t = COLD + TITLE;
    const parts = Excerpts.map((e) => {
        const card = t;
        const clip = card + CARD;
        t = clip + (e.to - e.from);
        return { ...e, card, clip, length: e.to - e.from };
    });
    return { parts, end: t, total: t + OUTRO };
}

const Fade: React.FC<{ length: number; children: React.ReactNode }> = ({ length, children }) => {
    const f = useCurrentFrame();
    const a = ramp(f, 0, FADE, Ease.glide) * (1 - ramp(f, length - FADE, length - 1, Ease.glide));
    return <AbsoluteFill style={{ opacity: a }}>{children}</AbsoluteFill>;
};

const NAME = "GenieTerm";
const PREFIX_W = [0, 67.6, 117.8, 169.9, 189.3, 239.6, 296.9, 347.1, 378.4, 458.9];

// The caret left on the plain terminal's prompt glides to the head of the name and types it.
const OverviewTitle: React.FC = () => {
    const f = useCurrentFrame();
    const typed = Math.max(0, Math.min(NAME.length, Math.floor((f - 40) / 5)));
    const x = 960 - (PREFIX_W[9] + 48) / 2;
    const from = coldCaret("agent");
    const travel = springAt(f, 0, Spring.large);
    const blue = ramp(f, 8, 40, Ease.move);
    const out = ramp(f, TITLE - 40, TITLE - 4, Ease.glide);
    const lineIn = ramp(f, 100, 150, Ease.enter);
    const blink = f < 40 + NAME.length * 5 + 20 ? 1 : Math.floor(f / 30) % 2 === 0 ? 1 : 0.15;
    return (
        <AbsoluteFill style={{ background: "#000", opacity: 1 - out, filter: `blur(${out * 8}px)` }}>
            <div style={{ position: "absolute", left: x, top: 430, fontFamily: SansFamily, fontWeight: 600, fontSize: 96, letterSpacing: "-0.03em", fontKerning: "none", lineHeight: 1, color: T.fg, whiteSpace: "pre" }}>
                {NAME.slice(0, typed)}
            </div>
            <div
                style={{
                    position: "absolute",
                    left: mix(from.x, x + 4, travel) + PREFIX_W[typed],
                    top: mix(from.y, 430 + 16, travel),
                    width: mix(from.w, 36, travel),
                    height: mix(from.h, 71, travel),
                    background: `rgb(${mix(208, 41, blue)}, ${mix(208, 151, blue)}, ${mix(208, 255, blue)})`,
                    opacity: blink,
                }}
            />
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 560,
                    textAlign: "center",
                    fontFamily: SansFamily,
                    fontWeight: 450,
                    fontSize: 34,
                    color: T.secondary,
                    opacity: lineIn,
                    transform: `translateY(${(1 - lineIn) * 14}px)`,
                    filter: `blur(${(1 - lineIn) * 6}px)`,
                }}
            >
                The remote-native terminal.
            </div>
        </AbsoluteFill>
    );
};

export const Overview: React.FC<{ audio?: string }> = ({ audio = "overview.wav" }) => {
    const { parts, end } = overviewLayout();
    return (
        <AbsoluteFill style={{ background: "#000" }}>
            <Sequence durationInFrames={COLD} name="Cold open">
                <ColdOpen story="agent" />
            </Sequence>
            <Sequence from={COLD} durationInFrames={TITLE} name="Title">
                <OverviewTitle />
            </Sequence>
            {parts.map((p) => {
                const Scene = p.scene;
                return (
                    <React.Fragment key={p.id}>
                        <Sequence from={p.card} durationInFrames={CARD} name={`Card ${p.id}`}>
                            <Card text={p.hook} length={CARD} />
                        </Sequence>
                        <Sequence from={p.clip} durationInFrames={p.length} name={`Clip ${p.id}`}>
                            <Fade length={p.length}>
                                <Sequence from={-p.from} layout="none">
                                    <Scene />
                                </Sequence>
                            </Fade>
                        </Sequence>
                    </React.Fragment>
                );
            })}
            <Sequence from={end} name="End">
                <EndCard start={0} tagline="The remote-native terminal." />
            </Sequence>
            <FilmGrain />
            {audio ? <Audio src={staticFile(audio)} /> : null}
        </AbsoluteFill>
    );
};
