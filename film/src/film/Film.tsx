import { CameraMotionBlur } from "@remotion/motion-blur";
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Ease, ramp } from "../lib/motion";
import { DURATION } from "../timeline";
import { LOGO, S1, S2, S3, S4, S5, S6, S7, S8 } from "../edl";
import { Grain, Vignette } from "../lib/backdrop";
import { EndCard } from "../lib/endcard";
import { loadFonts } from "../lib/fonts";
import { S1Open } from "./S1Open";
import { S2Train } from "./S2Train";
import { S3Lid } from "./S3Lid";
import { S4Host } from "./S4Host";
import { S5Ports } from "./S5Ports";
import { S6Files } from "./S6Files";
import { S7Fix } from "./S7Fix";
import { S8Exit } from "./S8Exit";

loadFonts();

// Motion blur only where the camera travels fast; everywhere else one sample keeps the
// type crisp and the render quick.
const FastMoves: [number, number][] = [
    [S1.from + S1.typing.enter, 46],
    [S3.from + S3.burst, 30],
    [S4.from + S4.click - 12, 34],
    [S5.from + S5.click + 8, 70],
    [S8.from + S8.typing.enter, 44],
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

const FadeOut: React.FC = () => {
    const f = useCurrentFrame();
    return <AbsoluteFill style={{ background: "black", opacity: ramp(f, DURATION - 54, DURATION - 4, [0, 1], Ease.glide) }} />;
};

const Shot: React.FC<{ from: number; to: number; children: React.ReactNode }> = ({ from, to, children }) => (
    <Sequence from={from} durationInFrames={to - from} premountFor={30}>
        {children}
    </Sequence>
);

export const Film: React.FC<{ audio?: string }> = ({ audio = "film.wav" }) => (
    <AbsoluteFill style={{ background: "#08090b" }}>
        <Blur>
            <Shot from={S1.from} to={S1.to}>
                <S1Open />
            </Shot>
            <Shot from={S2.from} to={S2.to}>
                <S2Train />
            </Shot>
            <Shot from={S3.from} to={S3.to}>
                <S3Lid />
            </Shot>
            <Shot from={S4.from} to={S4.to}>
                <S4Host />
            </Shot>
            <Shot from={S5.from} to={S5.to}>
                <S5Ports />
            </Shot>
            <Shot from={S6.from} to={S6.to}>
                <S6Files />
            </Shot>
            <Shot from={S7.from} to={S7.to}>
                <S7Fix />
            </Shot>
            <Shot from={S8.from} to={S8.to}>
                <S8Exit />
            </Shot>
        </Blur>
        <Sequence from={LOGO}>
            <EndCard start={0} />
        </Sequence>
        <Vignette />
        <Grain />
        <FadeOut />
        {audio ? <Audio src={staticFile(audio)} /> : null}
    </AbsoluteFill>
);
