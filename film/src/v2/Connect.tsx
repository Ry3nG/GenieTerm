import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Connect as C, UI_FORWARD } from "../edl";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { frameT, mapTime } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, indexAtTime, scene } from "../lib/frames";
import { boxToScreen, Callout, FocusRing, toScreen } from "../lib/guide";
import { Ease, ramp, springAt } from "../lib/motion";
import { breathe, ChapterShell } from "./shell";

export const ConnectChapter: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("c_connect");
    const len = C.to - C.from;
    const m = s.marks;
    const idx =
        f < C.click
            ? 0
            : indexAtTime(
                  s,
                  mapTime(
                      [
                          [C.click, frameT(s, m.open)],
                          [C.pick - 1, frameT(s, m.pick - 1)],
                          [C.pick, frameT(s, m.pick)],
                          [len, frameT(s, m.pick) + ((len - C.pick) / fps) * 1000],
                      ],
                      f
                  )
              );
    const keys: CamKey[] = [
        { f: 0, ...Home, z: 1 },
        { f: UI_FORWARD - 20, ...Home, z: 1.02 },
        { f: UI_FORWARD + 60, x: 250, y: 150, z: 2.2, ease: Ease.glide },
        { f: C.pick, x: 240, y: 140, z: 2.26, ease: Ease.linear },
        { f: C.pick + 90, x: 330, y: 120, z: 2.0, ease: Ease.glide },
        { f: len, x: 336, y: 118, z: 2.06, ease: Ease.linear },
    ];
    const cam = breathe(cameraAt(keys, f), f);
    const conn = s.conn;
    const item = s.item;
    const pointer = cursorAt(
        [
            { f: UI_FORWARD + 40, x: conn.x + 240, y: conn.y + 230 },
            { f: C.click, x: conn.x - 10, y: conn.y + 2, dur: 56, click: true },
            { f: C.pick, x: item.x - 6, y: item.y + 2, dur: 50, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, UI_FORWARD + 36, UI_FORWARD + 52, [0, 1]) * ramp(f, C.pick + 18, C.pick + 40, [1, 0]);
    const ring = ramp(f, UI_FORWARD + 50, UI_FORWARD + 80, [0, 1], Ease.reveal) * ramp(f, C.click + 4, C.click + 20, [1, 0]);
    const ringPulse = ramp(f, C.click - 30, C.click - 4, [0, 1], Ease.glide);
    const call = springAt(f - C.callout, fps, 1.0, 0) * ramp(f, len - 40, len - 18, [1, 0]);
    const connBox = boxToScreen(cam, { x: conn.x - conn.w / 2, y: conn.y - conn.h / 2, w: conn.w + 18, h: conn.h });
    return (
        <ChapterShell
            f={f}
            len={len}
            label="CONNECT"
            line="Pick a machine. The terminal moves there."
            stage={
                <Stage cam={cam}>
                    <CaptureWindow scene={s} index={idx} glow={0.5} />
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={15} />
                </Stage>
            }
            guides={
                <>
                    <FocusRing box={connBox} show={ring} pulse={ringPulse} radius={6} />
                    <Callout at={toScreen(cam, { x: 50, y: 58 })} side="down" reach={150} show={call} text="Now connected over SSH" />
                </>
            }
        />
    );
};
