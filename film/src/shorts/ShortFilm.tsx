import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { EndCard } from "../lib/endcard";
import { loadFonts } from "../lib/fonts";
import { FilmGrain } from "../kit/stage";
import { Card } from "../v3/Card";

loadFonts();

// One feature, one situation: a typed hook on black, the demonstration, then the name.
// Every short shares this frame so the series reads as one set.

export const HOOK = 160;
export const END = 300;

export type ShortSpec = { id: string; hook: string; feature: string; demo: React.FC; demoLength: number; audio?: string };

export const shortLength = (s: ShortSpec) => HOOK + s.demoLength + END;

export const ShortFilm: React.FC<{ spec: ShortSpec }> = ({ spec }) => {
    const Demo = spec.demo;
    return (
        <AbsoluteFill style={{ background: "#000" }}>
            <Sequence durationInFrames={HOOK} name="Hook">
                <Card text={spec.hook} length={HOOK} />
            </Sequence>
            <Sequence from={HOOK} durationInFrames={spec.demoLength} name="Demo">
                <Demo />
            </Sequence>
            <Sequence from={HOOK + spec.demoLength} durationInFrames={END} name="End">
                <EndCard start={0} tagline={spec.feature} />
            </Sequence>
            <FilmGrain />
            {spec.audio ? <Audio src={staticFile(spec.audio)} /> : null}
        </AbsoluteFill>
    );
};
