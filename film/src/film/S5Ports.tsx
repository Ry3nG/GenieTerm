import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { S5 } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Stage } from "../lib/camera";
import { clipIndex, frameT } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, scene } from "../lib/frames";
import { Sweep } from "../lib/lift";
import { Ease, ramp } from "../lib/motion";

// TensorBoard prints a localhost URL on the GPU box; GenieTerm offers to open it here.
export const S5Ports: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("s5_ports");
    const geo = s.geometry;
    const typing = S5.typing;
    const len = S5.to - S5.from;
    const tEnter = frameT(s, s.marks.enter);
    const tOffer = frameT(s, s.marks.offer);
    const tClick = frameT(s, s.marks.click);
    const cursorIdx = s.marks.click - 1;
    let idx: number;
    if (f < S5.click) {
        idx = Math.min(
            clipIndex(s, f, typing, [
                [typing.enter, tEnter],
                [S5.offer, tOffer],
                [S5.click, tOffer + ((S5.click - S5.offer) / fps) * 1000],
            ]),
            cursorIdx
        );
    } else {
        idx = clipIndex(s, f, null, [
            [S5.click, tClick],
            [S5.click + 40, tClick + 1800],
            [len, tClick + 1800 + ((len - S5.click - 40) / fps) * 2400],
        ]);
    }
    const dock = s.dock;
    const btn = s.btn;
    const promptY = geo.y + geo.cellH / 2;
    const outY = geo.y + 38.5 + geo.cellH * 5;
    // "TensorBoard 2.21.0 at http://localhost:6006/" is the ninth row; it's what the offer reads
    const urlY = geo.y + 38.5 + geo.cellH * 8.5;
    const dockX = dock.x + dock.w / 2;
    const dockY = dock.y + dock.h / 2;
    const dockZ = Math.min(2.7, (0.62 * 1920) / (1.05 * dock.w));
    const keys: CamKey[] = [
        { f: 0, x: geo.x + 210, y: promptY + 20, z: 2.4 },
        { f: typing.enter, x: geo.x + 230, y: promptY + 30, z: 2.25, ease: Ease.glide },
        { f: typing.enter + 40, x: geo.x + 420, y: outY, z: 1.7, ease: Ease.move },
        { f: S5.offer - 24, x: geo.x + 300, y: urlY, z: 2.3, ease: Ease.glide },
        { f: S5.offer + 46, x: dockX, y: dockY, z: dockZ, ease: Ease.move },
        { f: S5.click, x: dockX + 20, y: dockY, z: dockZ * 1.03, ease: Ease.linear },
        { f: S5.click + 80, x: 790, y: 560, z: 1.12, ease: Ease.move },
        { f: len, x: 790, y: 570, z: 1.16, ease: Ease.linear },
    ];
    const cam = cameraAt(keys, f);
    const pointer = cursorAt(
        [
            { f: S5.click - 54, x: btn.x - 260, y: btn.y - 180 },
            { f: S5.click, x: btn.x, y: btn.y, dur: 46, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, S5.click - 58, S5.click - 46, [0, 1]) * ramp(f, S5.click + 16, S5.click + 34, [1, 0]);
    const sweep = ramp(f, S5.offer + 30, S5.offer + 84, [0, 1], Ease.glide);
    return (
        <AbsoluteFill>
            <Backdrop />
            <Stage cam={cam}>
                <CaptureWindow scene={s} index={idx} glow={0.5} />
                <Sweep rect={dock} progress={sweep} radius={12} />
                <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={17} />
            </Stage>
        </AbsoluteFill>
    );
};
