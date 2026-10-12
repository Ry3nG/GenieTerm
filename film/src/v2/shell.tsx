import React from "react";
import { AbsoluteFill } from "remotion";
import { TITLE_IN, TITLE_OUT } from "../edl";
import { Backdrop } from "../lib/backdrop";
import type { Cam } from "../lib/camera";
import { ChapterTitle, Recede, recede } from "../lib/chapter";
import { Ease, ramp } from "../lib/motion";

// Small, slow, never-quite-still motion added to every camera: the "breathing" a locked-off
// screen recording never has.
export function breathe(cam: Cam, f: number): Cam {
    return {
        ...cam,
        z: cam.z * (1 + 0.006 * Math.sin(f / 170)),
        x: cam.x + 2.5 * Math.sin(f / 230 + 1.3),
        y: cam.y + 2 * Math.sin(f / 270 + 0.4),
    };
}

// One chapter: fades up from the dark, opens on its title while the product steps back, and
// fades down again at the end so chapters change through a short breath.
export const ChapterShell: React.FC<{
    f: number;
    len: number;
    label: string;
    line: string;
    stage: React.ReactNode;
    guides?: React.ReactNode;
}> = ({ f, len, label, line, stage, guides }) => {
    const fadeIn = ramp(f, 0, 22, [0, 1], Ease.glide);
    const fadeOut = ramp(f, len - 18, len, [1, 0], Ease.glide);
    const back = recede(f, TITLE_IN, TITLE_OUT);
    return (
        <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
            <Backdrop />
            <Recede amount={back}>{stage}</Recede>
            {guides}
            <ChapterTitle f={f} label={label} line={line} inAt={TITLE_IN} outAt={TITLE_OUT} />
        </AbsoluteFill>
    );
};
