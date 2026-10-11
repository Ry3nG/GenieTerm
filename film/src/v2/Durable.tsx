import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Durable as D, UI_FORWARD } from "../edl";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { clipIndex, frameT, mapTime } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { Laptop, Link, Moon, Server } from "../lib/diagram";
import { CaptureWindow, frameSrc, indexAtTime, scene } from "../lib/frames";
import { boxToScreen, Callout, FocusRing, toScreen } from "../lib/guide";
import { Ease, mix, ramp, springAt } from "../lib/motion";
import { Streak } from "../lib/streak";
import { breathe, ChapterShell } from "./shell";

const ACTION_BAR = 38.5;

// Where the laptop sits in the frame, and the rectangle its screen shows the app in.
const LAPTOP = { x: 640, bottom: 700, width: 980 };
const SCREEN = (() => {
    const sw = LAPTOP.width * 0.9;
    const sh = (sw * 9) / 16;
    const bezel = LAPTOP.width * 0.016;
    return { cx: LAPTOP.x, cy: LAPTOP.bottom - sh + bezel + (sh - 2 * bezel) / 2, w: sw - 2 * bezel };
})();
const SERVER = { x: 1400, bottom: 700, height: 520 };

// A Stage camera that puts the whole captured window exactly where the laptop screen is.
function camOnLaptop(): CamKey {
    const z = SCREEN.w / 1680;
    const s = 1.05 * z;
    return { f: 0, x: 800 - (SCREEN.cx - 960) / s, y: 450 - (SCREEN.cy - 540) / s, z };
}

export const DurableChapter: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const train = scene("s2_train");
    const lid = scene("s3_lid");
    const len = D.to - D.from;
    const geo = train.geometry;
    const typing = D.typing;

    // --- part 1: the real terminal, training ---
    const tEnter = frameT(train, train.marks.enter);
    const tEpoch12 = frameT(train, train.marks.epoch12);
    const trainIdx = clipIndex(train, f, typing, [
        [typing.enter, tEnter],
        [typing.enter + 12, tEnter + 500],
        [D.streamEnd, tEpoch12],
    ]);
    const row = (r: number, shifted: boolean) => geo.y + (shifted ? ACTION_BAR : 0) + geo.cellH * (r + 0.5);
    const logX = geo.x + 230;
    const onLaptop = camOnLaptop();
    const trainKeys: CamKey[] = [
        { f: 0, ...Home, z: 1 },
        { f: UI_FORWARD - 20, ...Home, z: 1.02 },
        { f: UI_FORWARD + 50, x: logX + 30, y: row(0, false) + 40, z: 2.3, ease: Ease.glide },
        { f: typing.enter, x: logX + 10, y: row(0, false) + 50, z: 2.25, ease: Ease.linear },
        { f: typing.enter + 50, x: logX, y: row(5, true), z: 2.1, ease: Ease.glide },
        { f: D.toDiagram[0], x: logX, y: row(10, true), z: 2.0, ease: Ease.linear },
        { ...onLaptop, f: D.toDiagram[1], ease: Ease.glide },
    ];
    const trainCam = breathe(cameraAt(trainKeys, f), f < D.toDiagram[0] ? f : D.toDiagram[0]);

    // --- part 2: the diagram ---
    const diagramIn = ramp(f, D.toDiagram[0] + 18, D.toDiagram[1] + 30, [0, 1], Ease.glide);
    const lidAmount =
        f < D.lidOpen[0] ? ramp(f, D.lidClose[0], D.lidClose[1], [0, 1], Ease.move) : ramp(f, D.lidOpen[0], D.lidOpen[1], [1, 0], Ease.move);
    const linkLive = f < D.lidClose[0] ? 1 : ramp(f, D.lidClose[0], D.lidClose[0] + 30, [1, 0]);
    const reconnectIdx = lid.marks.reconnect;
    const burstIdx = reconnectIdx + 3;
    const epochAtBurst = 31;
    const epoch =
        f < D.lidClose[0] ? 12 : f < D.serverOnly[1] ? mix(12, epochAtBurst, ramp(f, D.lidClose[0] + 10, D.serverOnly[1] + 20, [0, 1], Ease.linear)) : epochAtBurst;
    const laptopScreen = f < D.lidOpen[0] ? frameSrc(train, train.frames.length - 1) : frameSrc(lid, reconnectIdx - 2);
    const diveT = ramp(f, D.dive[0], D.dive[1], [0, 1], Ease.move);
    const diveScale = mix(1, 1680 / SCREEN.w, diveT);
    const diagramPush = 1 + ramp(f, D.toDiagram[1], D.lidOpen[1], [0, 0.035], Ease.linear);
    const serverCall = springAt(f - (D.serverOnly[0] + 20), fps, 1.0, 0) * ramp(f, D.serverOnly[1] - 10, D.serverOnly[1] + 14, [1, 0]);
    const moon = ramp(f, D.lidClose[1] - 10, D.lidClose[1] + 16, [0, 1], Ease.reveal) * ramp(f, D.lidOpen[0], D.lidOpen[0] + 20, [1, 0]);
    const labels = ramp(f, D.toDiagram[1], D.toDiagram[1] + 30, [0, 1], Ease.reveal) * (1 - diveT);
    const diagramOpacity = (f < D.toDiagram[0] ? 0 : diagramIn) * ramp(f, D.dive[1] - 10, D.dive[1], [1, 0]);
    const realTrainOpacity = f < D.toDiagram[1] ? 1 : 0;

    // --- part 3: back in the real window, reconnecting ---
    const tClick = frameT(lid, reconnectIdx);
    const tBurst = frameT(lid, burstIdx);
    const lidIdx =
        f < D.click
            ? reconnectIdx - 1
            : indexAtTime(
                  lid,
                  mapTime(
                      [
                          [D.click, tClick],
                          [D.burst - 1, tBurst - 1],
                          [D.burst, tBurst],
                          [len, tBurst + ((len - D.burst) / fps) * 1000],
                      ],
                      f
                  )
              );
    const lgeo = lid.geometry;
    const lrow = (r: number) => lgeo.y + lgeo.cellH * (r + 0.5);
    const tailRow = 33;
    const rc = lid.reconnectButton;
    const realKeys: CamKey[] = [
        { f: D.dive[1] - 12, ...Home, z: 1 },
        { f: D.click - 10, x: 820, y: 262, z: 1.12, ease: Ease.glide },
        { f: D.burst - 4, x: 812, y: 270, z: 1.1, ease: Ease.linear },
        { f: D.burst + 40, x: lgeo.x + 240, y: lrow(tailRow - 6), z: 2.2, ease: Ease.glide },
        { f: len, x: lgeo.x + 240, y: lrow(tailRow - 4), z: 2.32, ease: Ease.linear },
    ];
    const realCam = breathe(cameraAt(realKeys, f), f);
    const realOpacity = ramp(f, D.dive[1] - 12, D.dive[1], [0, 1]);
    const pointer = cursorAt(
        [
            { f: D.dive[1] + 10, x: rc.x - 320, y: rc.y + 240 },
            { f: D.click, x: rc.x, y: rc.y + 3, dur: 52, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = ramp(f, D.dive[1] + 6, D.dive[1] + 20, [0, 1]) * ramp(f, D.click + 16, D.click + 34, [1, 0]);
    const ring = ramp(f, D.dive[1] + 14, D.dive[1] + 44, [0, 1], Ease.reveal) * ramp(f, D.click + 2, D.click + 16, [1, 0]);
    const streak = ramp(f, D.burst, D.burst + 10, [0, 1], Ease.linear);
    const streakRect = { x: 0, y: lgeo.y + ACTION_BAR + lgeo.cellH * 13, w: 1550, h: lgeo.cellH * 22 };
    const doneCall = springAt(f - D.callout, fps, 1.0, 0) * ramp(f, len - 40, len - 18, [1, 0]);

    const linkA = { x: SCREEN.cx + SCREEN.w / 2 + 14, y: SCREEN.cy };
    const linkB = { x: SERVER.x - (SERVER.height * 0.62) / 2 - 14, y: SERVER.bottom - SERVER.height * 0.55 };

    return (
        <ChapterShell
            f={f}
            len={len}
            label="DURABLE SESSIONS"
            line="Close the lid. Your job keeps running."
            stage={
                <>
                    {realTrainOpacity > 0 && f < D.dive[0] ? (
                        <Stage cam={trainCam}>
                            <CaptureWindow scene={train} index={trainIdx} glow={0.5 * (1 - diagramIn)} />
                        </Stage>
                    ) : null}
                    {diagramOpacity > 0 ? (
                        <AbsoluteFill
                            style={{
                                opacity: diagramOpacity,
                                transform: `translate(${(960 - SCREEN.cx) * diveT}px, ${(540 - SCREEN.cy) * diveT}px) scale(${diveScale * diagramPush})`,
                                transformOrigin: `${SCREEN.cx}px ${SCREEN.cy}px`,
                            }}
                        >
                            <div style={{ position: "absolute", left: LAPTOP.x - 560, top: LAPTOP.bottom + 8, width: 1120, height: 70, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(0,0,0,0.55), rgba(0,0,0,0))" }} />
                            <div style={{ position: "absolute", left: SERVER.x - 240, top: SERVER.bottom - 6, width: 480, height: 60, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(0,0,0,0.6), rgba(0,0,0,0))" }} />
                            <Link a={linkA} b={linkB} frame={f} live={linkLive} show={labels} />
                            <Laptop x={LAPTOP.x} y={LAPTOP.bottom} width={LAPTOP.width} lid={lidAmount} screen={laptopScreen} label="Your laptop" labelShow={labels} />
                            <Moon x={LAPTOP.x} y={LAPTOP.bottom - 120} show={moon} />
                            <Server
                                x={SERVER.x}
                                y={SERVER.bottom}
                                height={SERVER.height}
                                frame={f}
                                epoch={epoch}
                                total={100}
                                busy={1}
                                label="GPU server"
                                labelShow={labels}
                            />
                        </AbsoluteFill>
                    ) : null}
                    {realOpacity > 0 ? (
                        <AbsoluteFill style={{ opacity: realOpacity }}>
                            <Stage cam={realCam}>
                                <CaptureWindow scene={lid} index={lidIdx} glow={0.5} />
                                <Streak src={frameSrc(lid, burstIdx)} rect={streakRect} progress={streak} travel={lgeo.cellH * 10} bg="#0e0e0e" />
                                <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={16} />
                            </Stage>
                        </AbsoluteFill>
                    ) : null}
                </>
            }
            guides={
                <>
                    <Callout
                        at={{ x: SERVER.x - 70, y: SERVER.bottom - SERVER.height * 0.22 }}
                        side="left"
                        reach={120}
                        show={serverCall}
                        text="Still training on the server"
                    />
                    {realOpacity > 0 ? (
                        <>
                            <FocusRing box={boxToScreen(realCam, { x: rc.x - rc.w / 2, y: rc.y - rc.h / 2, w: rc.w, h: rc.h })} show={ring} radius={6} />
                            <Callout at={toScreen(realCam, { x: lgeo.x + 360, y: lrow(tailRow - 1) })} side="right" reach={80} show={doneCall} text="Reconnected · nothing lost" />
                        </>
                    ) : null}
                </>
            }
        />
    );
};
