import { CameraMotionBlur } from "@remotion/motion-blur";
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Durable } from "../edl";
import { Grain, Vignette } from "../lib/backdrop";
import { loadFonts } from "../lib/fonts";
import { Ease, ramp } from "../lib/motion";
import { Chapters, DURATION } from "../timeline";
import { AiChapter } from "./Ai";
import { ConnectChapter } from "./Connect";
import { DurableChapter } from "./Durable";
import { FilesChapter } from "./Files";
import { HostChapter } from "./Host";
import { Intro } from "./Intro";
import { Outro } from "./Outro";
import { PortsChapter } from "./Ports";

loadFonts();

// The only fast camera moves left are the dives in and out of the laptop.
const FastMoves: [number, number][] = [
    [Chapters.durable.from + Durable.toDiagram[0], Durable.toDiagram[1] - Durable.toDiagram[0]],
    [Chapters.durable.from + Durable.dive[0], Durable.dive[1] - Durable.dive[0]],
];

const Blur: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const f = useCurrentFrame();
    const fast = FastMoves.some(([from, len]) => f >= from && f < from + len);
    return (
        <CameraMotionBlur shutterAngle={180} samples={fast ? 8 : 1}>
            {children}
        </CameraMotionBlur>
    );
};

const Part: React.FC<{ from: number; to: number; children: React.ReactNode }> = ({ from, to, children }) => (
    <Sequence from={from} durationInFrames={to - from} premountFor={30}>
        {children}
    </Sequence>
);

const FadeOut: React.FC = () => {
    const f = useCurrentFrame();
    return <AbsoluteFill style={{ background: "black", opacity: ramp(f, DURATION - 60, DURATION - 4, [0, 1], Ease.glide) }} />;
};

export const FilmV2: React.FC<{ audio?: string }> = ({ audio = "film.wav" }) => (
    <AbsoluteFill style={{ background: "#08090b" }}>
        <Blur>
            <Part {...Chapters.intro}>
                <Intro />
            </Part>
            <Part {...Chapters.connect}>
                <ConnectChapter />
            </Part>
            <Part {...Chapters.files}>
                <FilesChapter />
            </Part>
            <Part {...Chapters.durable}>
                <DurableChapter />
            </Part>
            <Part {...Chapters.host}>
                <HostChapter />
            </Part>
            <Part {...Chapters.ports}>
                <PortsChapter />
            </Part>
            <Part {...Chapters.ai}>
                <AiChapter />
            </Part>
            <Part from={Chapters.outro.from} to={DURATION}>
                <Outro />
            </Part>
        </Blur>
        <Vignette amount={0.5} />
        <Grain opacity={0.04} />
        <FadeOut />
        {audio ? <Audio src={staticFile(audio)} /> : null}
    </AbsoluteFill>
);
