import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { EndCard } from "../lib/endcard";
import { loadFonts } from "../lib/fonts";
import { FilmGrain } from "../kit/stage";
import { Card } from "../v3/Card";
import { ColdOpen, type ColdStory } from "../v3/ColdOpen";

loadFonts();

// One feature, one situation: a typed hook on black, the demonstration, then the name.
// Every short shares this frame so the series reads as one set.

export const HOOK = 160;
export const END = 300;
export const COLD = 640;

// `cold`, when set, opens on the same moment in an ordinary terminal before the hook.
export type ShortSpec = { id: string; hook: string; feature: string; demo: React.FC; demoLength: number; audio?: string; cold?: ColdStory };

export const coldLength = (s: ShortSpec) => (s.cold ? COLD : 0);
export const shortLength = (s: ShortSpec) => coldLength(s) + HOOK + s.demoLength + END;

export const ShortFilm: React.FC<{ spec: ShortSpec }> = ({ spec }) => {
    const Demo = spec.demo;
    const c = coldLength(spec);
    return (
        <AbsoluteFill style={{ background: "#000" }}>
            {spec.cold && (
                <Sequence durationInFrames={COLD} name="Cold open">
                    <ColdOpen story={spec.cold} keepCaret={false} />
                </Sequence>
            )}
            <Sequence from={c} durationInFrames={HOOK} name="Hook">
                <Card text={spec.hook} length={HOOK} />
            </Sequence>
            <Sequence from={c + HOOK} durationInFrames={spec.demoLength} name="Demo">
                <Demo />
            </Sequence>
            <Sequence from={c + HOOK + spec.demoLength} durationInFrames={END} name="End">
                <EndCard start={0} tagline={spec.feature} />
            </Sequence>
            <FilmGrain />
            {spec.audio ? <Audio src={staticFile(spec.audio)} /> : null}
        </AbsoluteFill>
    );
};
