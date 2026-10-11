import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { S4 } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Stage } from "../lib/camera";
import { clipIndex, frameT } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, frameSrc, scene } from "../lib/frames";
import { Lift, Sweep } from "../lib/lift";
import { Ease, ramp, springAt } from "../lib/motion";

// nvidia-smi the way everyone checks a GPU, then the same machine in Host: the card lifts
// off the window with the training process still on it.
export const S4Host: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("s4_host");
    const geo = s.geometry;
    const typing = S4.typing;
    const len = S4.to - S4.from;
    const click = S4.click;
    const tEnter = frameT(s, s.marks.enter);
    const tClick = frameT(s, s.marks.hostClick);
    const cursorIdx = s.marks.hostClick - 1;
    const idx =
        f < click
            ? Math.min(clipIndex(s, f, typing, [[typing.enter, tEnter], [typing.enter + 90, tEnter + 1500]]), cursorIdx)
            : clipIndex(s, f, null, [
                  [click, tClick],
                  [click + 50, tClick + 1600],
                  [len, tClick + 1600 + ((len - click - 50) / fps) * 1000],
              ]);
    const gpu = s.rects.gpu;
    const rail = s.rail;
    const promptY = geo.y + geo.cellH / 2;
    const tableX = geo.x + 360;
    const tableY = geo.y + 38.5 + geo.cellH * 11;
    // the card spans the whole Host pane; frame its right half, where the live numbers and
    // the training process are
    const gpuX = gpu.x + gpu.w * 0.68;
    const gpuY = gpu.y + gpu.h / 2;
    const gpuZ = 2.0;
    const keys: CamKey[] = [
        { f: 0, x: geo.x + 150, y: promptY + 20, z: 2.4 },
        { f: typing.enter, x: geo.x + 160, y: promptY + 30, z: 2.3, ease: Ease.glide },
        { f: typing.enter + 50, x: tableX, y: tableY, z: 1.55, ease: Ease.move },
        { f: click - 70, x: tableX + 30, y: tableY - 10, z: 1.5, ease: Ease.linear },
        { f: click, x: 1000, y: 320, z: 1.12, ease: Ease.move },
        { f: click + 70, x: 1050, y: 400, z: 1.05, ease: Ease.glide },
        { f: click + 130, x: gpuX, y: gpuY, z: gpuZ, ease: Ease.move },
        { f: len, x: gpuX + 8, y: gpuY - 4, z: gpuZ * 1.04, ease: Ease.linear },
    ];
    const cam = cameraAt(keys, f);
    const pointer = cursorAt(
        [
            { f: click - 80, x: tableX + 120, y: tableY + 60 },
            { f: click, x: rail.x, y: rail.y, dur: 62, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, click - 84, click - 70, [0, 1]) * ramp(f, click + 16, click + 34, [1, 0]);
    const lift = f < click + 120 ? 0 : springAt(f - (click + 120), fps, 0.9, 0.08);
    const sweep = ramp(f, click + 170, click + 230, [0, 1], Ease.glide);
    return (
        <AbsoluteFill>
            <Backdrop />
            <Stage cam={cam}>
                <CaptureWindow scene={s} index={idx} glow={0.5} />
                <Lift src={frameSrc(s, idx)} rect={gpu} amount={lift} dim={0.32} />
                <Sweep rect={{ ...gpu, y: gpu.y - 6 * lift }} progress={sweep} />
                <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={17} />
            </Stage>
        </AbsoluteFill>
    );
};
