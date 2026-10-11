import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Ports as P, UI_FORWARD } from "../edl";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { clipIndex, frameT } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, scene } from "../lib/frames";
import { boxToScreen, Callout, FocusRing, Marker, toScreen } from "../lib/guide";
import { Ease, ramp, springAt } from "../lib/motion";
import { breathe, ChapterShell } from "./shell";

const ACTION_BAR = 38.5;

export const PortsChapter: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("s5_ports");
    const len = P.to - P.from;
    const geo = s.geometry;
    const m = s.marks;
    const t = (i: number) => frameT(s, i);
    const typing = P.typing;
    const idx =
        f < P.click
            ? Math.min(
                  clipIndex(s, f, typing, [
                      [typing.enter, t(m.enter)],
                      [P.offer, t(m.offer)],
                      [P.click, t(m.offer) + ((P.click - P.offer) / fps) * 1000],
                  ]),
                  m.click - 1
              )
            : clipIndex(s, f, null, [
                  [P.click, t(m.click)],
                  [len, t(m.click) + ((len - P.click) / fps) * 1400],
              ]);
    const urlRow = 8;
    const url = { x: geo.x + geo.cellW * 22, y: geo.y + ACTION_BAR + geo.cellH * urlRow, w: geo.cellW * 22, h: geo.cellH };
    const dock = s.dock;
    const btn = s.btn;
    const keys: CamKey[] = [
        { f: 0, ...Home, z: 1 },
        { f: UI_FORWARD - 20, ...Home, z: 1.02 },
        { f: UI_FORWARD + 50, x: geo.x + 250, y: geo.y + 40, z: 2.3, ease: Ease.glide },
        { f: typing.enter, x: geo.x + 300, y: geo.y + 50, z: 2.25, ease: Ease.linear },
        { f: typing.enter + 40, x: url.x + 60, y: url.y, z: 2.1, ease: Ease.glide },
        { f: P.offer + 4, x: url.x + 70, y: url.y + 4, z: 2.12, ease: Ease.linear },
        { f: P.offer + 50, x: dock.x + dock.w / 2, y: dock.y + dock.h / 2 - 30, z: 2.1, ease: Ease.glide },
        { f: P.click, x: dock.x + dock.w / 2 + 10, y: dock.y + dock.h / 2 - 30, z: 2.15, ease: Ease.linear },
        { f: P.click + 90, x: 800, y: 560, z: 1.12, ease: Ease.glide },
        { f: len, x: 800, y: 566, z: 1.16, ease: Ease.linear },
    ];
    const cam = breathe(cameraAt(keys, f), f);
    const pointer = cursorAt(
        [
            { f: P.click - 60, x: btn.x - 260, y: btn.y - 170 },
            { f: P.click, x: btn.x, y: btn.y, dur: 50, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, P.click - 64, P.click - 50, [0, 1]) * ramp(f, P.click + 16, P.click + 34, [1, 0]);
    const marker = ramp(f, P.url, P.url + 26, [0, 1], Ease.reveal) * ramp(f, P.offer + 30, P.offer + 50, [1, 0]);
    const ring = ramp(f, P.offer + 40, P.offer + 70, [0, 1], Ease.reveal) * ramp(f, P.click + 2, P.click + 18, [1, 0]);
    const ringPulse = ramp(f, P.click - 30, P.click - 4, [0, 1], Ease.glide);
    const offerCall = springAt(f - (P.offer + 36), fps, 1.0, 0) * ramp(f, P.click - 6, P.click + 14, [1, 0]);
    const doneCall = springAt(f - P.callout, fps, 1.0, 0) * ramp(f, len - 40, len - 18, [1, 0]);
    return (
        <ChapterShell
            f={f}
            len={len}
            label="PORTS"
            line="A server on the remote machine opens right here."
            stage={
                <Stage cam={cam}>
                    <CaptureWindow scene={s} index={idx} glow={0.5} />
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={15} />
                </Stage>
            }
            guides={
                <>
                    <Marker box={boxToScreen(cam, url)} show={marker} />
                    <FocusRing box={boxToScreen(cam, { x: btn.x - btn.w / 2, y: btn.y - btn.h / 2, w: btn.w, h: btn.h })} show={ring} pulse={ringPulse} radius={6} />
                    <Callout at={toScreen(cam, { x: dock.x + 120, y: dock.y + 4 })} side="up" reach={70} show={offerCall} text="TensorBoard, running on the server" />
                    <Callout at={toScreen(cam, { x: dock.x + 120, y: 425 })} side="up" reach={60} show={doneCall} text="Forwarded here as localhost:6006" />
                </>
            }
        />
    );
};
