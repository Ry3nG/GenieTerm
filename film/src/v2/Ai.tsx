import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Ai as A, UI_FORWARD } from "../edl";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { clipIndex, frameT, type TimeMap } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, scene } from "../lib/frames";
import { boxToScreen, Callout, FocusRing, Marker, toScreen } from "../lib/guide";
import { Ease, ramp, springAt } from "../lib/motion";
import { breathe, ChapterShell } from "./shell";

// Where things sit in the captured frames (CSS pixels of the 1600x900 window).
const ERROR_LINE = { x: 60, y: 636, w: 735, h: 15 };
const SUCCESS_LINE = { x: 20, y: 862, w: 360, h: 14 };

export const AiChapter: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("s7_fix");
    const len = A.to - A.from;
    const m = s.marks;
    const t = (i: number) => frameT(s, Math.min(i, s.frames.length - 1));
    const typing = A.typing;
    const map: TimeMap = [
        [typing.enter, t(m.enter)],
        [A.failed, t(m.failed)],
        [A.ask - 1, t(m.askAi - 1)],
        [A.ask, t(m.askAi)],
        [A.answer, t(m.aiReady)],
        [A.insert - 1, t(m.insert - 1)],
        [A.insert, t(m.insert)],
        [A.run - 1, t(m.run - 1)],
        [A.run, t(m.run)],
        [A.fixed, t(m.fixed)],
        [len, t(m.fixed) + ((len - A.fixed) / fps) * 1000],
    ];
    const idx = clipIndex(s, f, typing, map);
    const geo = s.geometry;
    const fix = s.fix;
    const ins = s.ins;
    const card = { x: ins.x - 52, y: ins.y - 98, w: 708, h: 122 };
    const keys: CamKey[] = [
        { f: 0, ...Home, z: 1 },
        { f: UI_FORWARD - 20, ...Home, z: 1.02 },
        { f: UI_FORWARD + 50, x: geo.x + 260, y: geo.y + 40, z: 2.3, ease: Ease.glide },
        { f: typing.enter, x: geo.x + 280, y: geo.y + 50, z: 2.25, ease: Ease.linear },
        { f: A.failed, x: 640, y: 420, z: 1.12, ease: Ease.glide },
        { f: A.failed + 50, x: 430, y: ERROR_LINE.y, z: 1.85, ease: Ease.glide },
        { f: A.ask - 34, x: 440, y: ERROR_LINE.y - 6, z: 1.88, ease: Ease.linear },
        { f: A.ask - 4, x: 1060, y: 330, z: 1.22, ease: Ease.glide },
        { f: A.answer + 20, x: 790, y: 560, z: 1.55, ease: Ease.glide },
        { f: A.insert, x: 780, y: 566, z: 1.6, ease: Ease.linear },
        { f: A.run + 10, x: 520, y: 760, z: 1.55, ease: Ease.glide },
        { f: A.fixed + 30, x: 520, y: SUCCESS_LINE.y - 40, z: 1.75, ease: Ease.glide },
        { f: len, x: 524, y: SUCCESS_LINE.y - 42, z: 1.82, ease: Ease.linear },
    ];
    const cam = breathe(cameraAt(keys, f), f);
    const pointer = cursorAt(
        [
            { f: A.ask - 54, x: fix.x - 240, y: fix.y + 200 },
            { f: A.ask, x: fix.x, y: fix.y, dur: 48, click: true },
            { f: A.insert, x: ins.x, y: ins.y, dur: 52, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, A.ask - 58, A.ask - 44, [0, 1]) * ramp(f, A.insert + 16, A.insert + 34, [1, 0]);
    const errMark = ramp(f, A.failed + 46, A.failed + 74, [0, 1], Ease.reveal) * ramp(f, A.ask - 30, A.ask - 10, [1, 0]);
    const sparkRing = ramp(f, A.ask - 40, A.ask - 16, [0, 1], Ease.reveal) * ramp(f, A.ask + 2, A.ask + 16, [1, 0]);
    const cardRing = ramp(f, A.answer + 24, A.answer + 50, [0, 1], Ease.reveal) * ramp(f, A.insert + 2, A.insert + 16, [1, 0]);
    const aiCall = springAt(f - (A.answer + 30), fps, 1.0, 0) * ramp(f, A.insert - 8, A.insert + 12, [1, 0]);
    const okMark = ramp(f, A.fixed + 6, A.fixed + 34, [0, 1], Ease.reveal);
    const okCall = springAt(f - (A.fixed + 26), fps, 1.0, 0) * ramp(f, len - 40, len - 18, [1, 0]);
    return (
        <ChapterShell
            f={f}
            len={len}
            label="COMMAND AI"
            line="When a command fails, ask the AI you already use."
            stage={
                <Stage cam={cam}>
                    <CaptureWindow scene={s} index={idx} glow={0.5} />
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={15} />
                </Stage>
            }
            guides={
                <>
                    <Marker box={boxToScreen(cam, ERROR_LINE)} show={errMark} color="rgba(255,120,110,0.22)" />
                    <FocusRing box={boxToScreen(cam, { x: fix.x - fix.w / 2, y: fix.y - fix.h / 2, w: fix.w, h: fix.h })} show={sparkRing} pulse={ramp(f, A.ask - 26, A.ask - 4, [0, 1])} radius={6} />
                    <FocusRing box={boxToScreen(cam, card)} show={cardRing} radius={10} pad={4} />
                    <Callout at={toScreen(cam, { x: card.x + card.w - 10, y: card.y - 4 })} side="up" reach={56} show={aiCall} text="Suggested by Claude Code, running locally" />
                    <Marker box={boxToScreen(cam, SUCCESS_LINE)} show={okMark} color="rgba(110,231,160,0.22)" />
                    <Callout at={toScreen(cam, { x: SUCCESS_LINE.x + SUCCESS_LINE.w + 10, y: SUCCESS_LINE.y + 7 })} side="right" reach={70} show={okCall} text="Installed with the suggested fix" />
                </>
            }
        />
    );
};
