import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { S7 } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Stage } from "../lib/camera";
import { clipIndex, frameT, type TimeMap } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, scene } from "../lib/frames";
import { Ease, ramp } from "../lib/motion";

// The install every GPU person has fought with fails for real; the sparkle asks the AI you
// already have, its fix is inserted at the prompt, and it works.
export const S7Fix: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("s7_fix");
    const geo = s.geometry;
    const typing = S7.typing;
    const len = S7.to - S7.from;
    const m = s.marks;
    const t = (i: number) => frameT(s, i);
    const map: TimeMap = [
        [typing.enter, t(m.enter)],
        [S7.failed, t(m.failed)],
        [S7.ask - 1, t(m.askAi - 1)],
        [S7.ask, t(m.askAi)],
        [S7.answer, t(m.aiReady)],
        [S7.insert - 1, t(m.insert - 1)],
        [S7.insert, t(m.insert)],
        [S7.run - 1, t(m.run - 1)],
        [S7.run, t(m.run)],
        [S7.fixed, t(m.fixed)],
        [len, t(m.fixed) + ((len - S7.fixed) / fps) * 1000],
    ];
    const idx = clipIndex(s, f, typing, map);
    const fix = s.fix;
    const ins = s.ins;
    const promptY = geo.y + geo.cellH / 2;
    const errY = geo.y + 38.5 + geo.cellH * 34;
    const keys: CamKey[] = [
        { f: 0, x: geo.x + 180, y: promptY + 20, z: 2.4 },
        { f: typing.enter, x: geo.x + 190, y: promptY + 30, z: 2.3, ease: Ease.glide },
        { f: S7.failed - 6, x: 640, y: 380, z: 1.12, ease: Ease.move },
        { f: S7.failed + 50, x: 420, y: errY, z: 1.9, ease: Ease.move },
        { f: S7.ask - 30, x: 980, y: 330, z: 1.2, ease: Ease.move },
        { f: S7.answer + 10, x: 780, y: 560, z: 1.55, ease: Ease.move },
        { f: S7.insert, x: 700, y: 560, z: 1.62, ease: Ease.linear },
        { f: S7.run, x: 420, y: 680, z: 1.9, ease: Ease.move },
        { f: S7.fixed, x: 620, y: 800, z: 1.5, ease: Ease.glide },
        { f: len, x: 620, y: 806, z: 1.56, ease: Ease.linear },
    ];
    const cam = cameraAt(keys, f);
    const pointer = cursorAt(
        [
            { f: S7.ask - 50, x: fix.x + fix.w / 2 - 240, y: fix.y + 200 },
            { f: S7.ask, x: fix.x + fix.w / 2, y: fix.y + fix.h / 2, dur: 46, click: true },
            { f: S7.insert, x: ins.x, y: ins.y, dur: 40, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, S7.ask - 54, S7.ask - 42, [0, 1]) * ramp(f, S7.insert + 16, S7.insert + 34, [1, 0]);
    const success = ramp(f, S7.fixed - 4, S7.fixed + 10, [0, 1], Ease.reveal) * ramp(f, S7.fixed + 30, S7.fixed + 110, [1, 0]);
    return (
        <AbsoluteFill>
            <Backdrop />
            <Stage cam={cam}>
                <CaptureWindow scene={s} index={idx} glow={0.5 + success * 0.4} />
                <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={17} />
            </Stage>
        </AbsoluteFill>
    );
};
