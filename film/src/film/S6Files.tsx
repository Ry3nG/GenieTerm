import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { S6 } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Stage } from "../lib/camera";
import { clipIndex, frameT } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, scene } from "../lib/frames";
import { Ease, ramp } from "../lib/motion";

// The folder the shell is in, opened beside it; one double-click and train.py is on screen.
export const S6Files: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("s6_files");
    const geo = s.geometry;
    const typing = S6.typing;
    const len = S6.to - S6.from;
    const tEnter = frameT(s, s.marks.enter);
    const tOpen = frameT(s, s.marks.open);
    const cursorIdx = s.marks.open - 1;
    const idx =
        f < S6.open
            ? Math.min(clipIndex(s, f, typing, [[typing.enter, tEnter], [typing.enter + 60, tEnter + 1500]]), cursorIdx)
            : clipIndex(s, f, null, [
                  [S6.open, tOpen],
                  [len, tOpen + ((len - S6.open) / fps) * 1300],
              ]);
    const row = s.row;
    const promptY = geo.y + geo.cellH / 2;
    const keys: CamKey[] = [
        { f: 0, x: geo.x + 150, y: promptY + 20, z: 2.4 },
        { f: typing.enter, x: geo.x + 160, y: promptY + 30, z: 2.3, ease: Ease.glide },
        { f: typing.enter + 56, x: 770, y: 580, z: 1.14, ease: Ease.move },
        { f: S6.open, x: 640, y: row.y - 40, z: 1.45, ease: Ease.glide },
        { f: S6.open + 60, x: 760, y: 690, z: 1.32, ease: Ease.move },
        { f: len, x: 760, y: 690, z: 1.38, ease: Ease.linear },
    ];
    const cam = cameraAt(keys, f);
    const pointer = cursorAt(
        [
            { f: S6.open - 50, x: row.x + 160, y: row.y + 140 },
            { f: S6.open, x: row.x, y: row.y, dur: 42, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, S6.open - 54, S6.open - 42, [0, 1]) * ramp(f, S6.open + 18, S6.open + 34, [1, 0]);
    return (
        <AbsoluteFill>
            <Backdrop />
            <Stage cam={cam}>
                <CaptureWindow scene={s} index={idx} glow={0.5} />
                <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={17} />
            </Stage>
        </AbsoluteFill>
    );
};
