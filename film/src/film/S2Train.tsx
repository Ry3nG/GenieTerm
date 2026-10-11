import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { S2 } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Stage } from "../lib/camera";
import { clipIndex, frameT } from "../lib/clip";
import { CaptureWindow, scene } from "../lib/frames";
import { Ease } from "../lib/motion";

// Rows shift down by the command action bar once a command starts.
export const ACTION_BAR = 38.5;

export const S2Train: React.FC = () => {
    const f = useCurrentFrame();
    const s = scene("s2_train");
    const geo = s.geometry;
    const typing = S2.typing;
    const len = S2.to - S2.from;
    const tEnter = frameT(s, s.marks.enter);
    const tEnd = frameT(s, s.marks.epoch12);
    const idx = clipIndex(s, f, typing, [
        [typing.enter, tEnter],
        [typing.enter + 10, tEnter + 400],
        [len, tEnd],
    ]);
    const row = (r: number, shifted: boolean) => geo.y + (shifted ? ACTION_BAR : 0) + geo.cellH * (r + 0.5);
    const left = geo.x + 230;
    const keys: CamKey[] = [
        { f: 0, x: left + 40, y: row(0, false) + 30, z: 2.5 },
        { f: typing.enter, x: left + 10, y: row(0, false) + 40, z: 2.35, ease: Ease.glide },
        { f: typing.enter + 40, x: left, y: row(4, true), z: 2.2, ease: Ease.move },
        { f: len, x: left - 10, y: row(11, true), z: 2.05, ease: Ease.linear },
    ];
    const cam = cameraAt(keys, f);
    return (
        <AbsoluteFill>
            <Backdrop />
            <Stage cam={cam}>
                <CaptureWindow scene={s} index={idx} glow={0.5} />
            </Stage>
        </AbsoluteFill>
    );
};
