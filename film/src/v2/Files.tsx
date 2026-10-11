import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Files as F, UI_FORWARD } from "../edl";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { frameT, mapTime } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, indexAtTime, scene } from "../lib/frames";
import { boxToScreen, Callout, FocusRing, toScreen } from "../lib/guide";
import { Ease, ramp, springAt } from "../lib/motion";
import { breathe, ChapterShell } from "./shell";

export const FilesChapter: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("c_files");
    const len = F.to - F.from;
    const m = s.marks;
    const t = (i: number) => frameT(s, i);
    const idx =
        f < F.click
            ? 0
            : indexAtTime(
                  s,
                  mapTime(
                      [
                          [F.click, t(m.click)],
                          [F.open - 1, t(m.open - 1)],
                          [F.open, t(m.open)],
                          [len, t(m.open) + ((len - F.open) / fps) * 1000],
                      ],
                      f
                  )
              );
    const cwd = s.cwd;
    const row = s.row;
    const keys: CamKey[] = [
        { f: 0, ...Home, z: 1 },
        { f: UI_FORWARD - 20, ...Home, z: 1.02 },
        { f: UI_FORWARD + 40, x: 260, y: 150, z: 2.2, ease: Ease.glide },
        { f: F.click, x: 250, y: 140, z: 2.24, ease: Ease.linear },
        { f: F.click + 70, x: 700, y: 640, z: 1.2, ease: Ease.glide },
        { f: F.open, x: 680, y: 660, z: 1.26, ease: Ease.linear },
        { f: F.open + 60, x: 760, y: 690, z: 1.34, ease: Ease.glide },
        { f: len, x: 760, y: 692, z: 1.4, ease: Ease.linear },
    ];
    const cam = breathe(cameraAt(keys, f), f);
    const pointer = cursorAt(
        [
            { f: UI_FORWARD + 20, x: cwd.x + 220, y: cwd.y + 240 },
            { f: F.click, x: cwd.x, y: cwd.y + 2, dur: 54, click: true },
            { f: F.open, x: row.x - 380, y: row.y, dur: 70, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, UI_FORWARD + 16, UI_FORWARD + 30, [0, 1]) * ramp(f, F.open + 16, F.open + 34, [1, 0]);
    const ring = ramp(f, UI_FORWARD + 30, UI_FORWARD + 60, [0, 1], Ease.reveal) * ramp(f, F.click + 2, F.click + 18, [1, 0]);
    const ringPulse = ramp(f, F.click - 30, F.click - 4, [0, 1], Ease.glide);
    const call = springAt(f - F.callout, fps, 1.0, 0) * ramp(f, len - 40, len - 18, [1, 0]);
    return (
        <ChapterShell
            f={f}
            len={len}
            label="FILES"
            line="Click the path. The folder opens beside you."
            stage={
                <Stage cam={cam}>
                    <CaptureWindow scene={s} index={idx} glow={0.5} />
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={15} />
                </Stage>
            }
            guides={
                <>
                    <FocusRing box={boxToScreen(cam, { x: cwd.x - cwd.w / 2, y: cwd.y - cwd.h / 2, w: cwd.w, h: cwd.h })} show={ring} pulse={ringPulse} radius={5} />
                    <Callout at={toScreen(cam, { x: 520, y: 480 })} side="up" reach={60} show={call} text="train.py, opened straight from the server" />
                </>
            }
        />
    );
};
