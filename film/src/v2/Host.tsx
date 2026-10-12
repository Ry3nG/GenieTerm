import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Host as H, UI_FORWARD } from "../edl";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { frameT, mapTime } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, indexAtTime, scene } from "../lib/frames";
import { GpuCard, SidebarGpuPatch } from "../lib/gpucard";
import { boxToScreen, Callout, FocusRing, toScreen } from "../lib/guide";
import { Ease, ramp, springAt } from "../lib/motion";
import { breathe, ChapterShell } from "./shell";

export const HostChapter: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("c_host");
    const len = H.to - H.from;
    const tClick = frameT(s, s.marks.click);
    const idx =
        f < H.click
            ? 0
            : indexAtTime(
                  s,
                  mapTime(
                      [
                          [H.click, tClick],
                          [H.gpu, tClick + 2600],
                          [len, tClick + 2600 + ((len - H.gpu) / fps) * 1000],
                      ],
                      f
                  )
              );
    const gpu = s.rects.gpu;
    const rail = s.rail;
    const gpuX = gpu.x + gpu.w / 2;
    const gpuY = gpu.y + gpu.h / 2 + 20;
    const gpuZ = Math.min(2.4, (0.62 * 1920) / (1.05 * gpu.w));
    const keys: CamKey[] = [
        { f: 0, ...Home, z: 1 },
        { f: UI_FORWARD - 20, ...Home, z: 1.02 },
        { f: UI_FORWARD + 50, x: 1080, y: 330, z: 1.22, ease: Ease.glide },
        { f: H.click, x: 1100, y: 340, z: 1.25, ease: Ease.linear },
        { f: H.click + 70, x: 1150, y: 420, z: 1.15, ease: Ease.glide },
        { f: H.lift + 40, x: gpuX, y: gpuY, z: gpuZ, ease: Ease.glide },
        { f: len, x: gpuX + 6, y: gpuY - 2, z: gpuZ * 1.04, ease: Ease.linear },
    ];
    const cam = breathe(cameraAt(keys, f), f);
    const pointer = cursorAt(
        [
            { f: UI_FORWARD + 30, x: rail.x - 300, y: rail.y + 260 },
            { f: H.click, x: rail.x, y: rail.y, dur: 60, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, UI_FORWARD + 26, UI_FORWARD + 40, [0, 1]) * ramp(f, H.click + 16, H.click + 34, [1, 0]);
    const ring = ramp(f, UI_FORWARD + 40, UI_FORWARD + 70, [0, 1], Ease.reveal) * ramp(f, H.click + 2, H.click + 18, [1, 0]);
    const lift = f < H.lift ? 0 : springAt(f - H.lift, fps, 1.1, 0.04);
    // the clean card replaces the real one as soon as Host has drawn it
    const cardIn = ramp(f, H.click + 36, H.click + 50, [0, 1], Ease.glide);
    const build = ramp(f, H.lift, H.lift + 110, [0, 1], Ease.linear);
    const call = springAt(f - H.callout, fps, 1.0, 0) * ramp(f, len - 40, len - 18, [1, 0]);
    return (
        <ChapterShell
            f={f}
            len={len}
            label="HOST"
            line="Every GPU and every process, live."
            stage={
                <Stage cam={cam}>
                    <div style={{ filter: lift > 0.01 ? `blur(${2.6 * lift}px) brightness(${1 - 0.42 * lift})` : undefined }}>
                        <CaptureWindow scene={s} index={idx} glow={0.5} />
                        {f >= H.click + 36 ? <SidebarGpuPatch /> : null}
                    </div>
                    <div
                        style={{
                            position: "absolute",
                            left: gpu.x,
                            top: gpu.y,
                            width: gpu.w,
                            height: gpu.h,
                            opacity: cardIn,
                            transform: `translateY(${-8 * lift}px) scale(${1 + 0.04 * lift})`,
                            borderRadius: 10,
                            boxShadow: `0 ${22 * lift}px ${56 * lift}px rgba(0,0,0,${0.6 * lift}), 0 0 ${70 * lift}px rgba(77,141,255,${0.14 * lift})`,
                        }}
                    >
                        <GpuCard x={0} y={0} build={build} frame={f} />
                    </div>
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={15} />
                </Stage>
            }
            guides={
                <>
                    <FocusRing box={boxToScreen(cam, { x: rail.x - 20, y: rail.y - 22, w: 40, h: 46 })} show={ring} radius={8} />
                    <Callout at={toScreen(cam, { x: gpu.x + 40, y: gpu.y + 205 - 8 * lift })} side="down" reach={74} show={call} text="Your training run · 3.4 GB" />
                </>
            }
        />
    );
};
