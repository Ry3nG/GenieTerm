import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { S3 } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Stage } from "../lib/camera";
import { frameT, mapTime } from "../lib/clip";
import { cursorAt, Pointer } from "../lib/cursor";
import { CaptureWindow, frameSrc, indexAtTime, scene } from "../lib/frames";
import { Lid } from "../lib/lid";
import { Ease, ramp } from "../lib/motion";
import { Streak } from "../lib/streak";
import { ACTION_BAR } from "./S2Train";

// The lid closes on epoch 12. While it is shut the job keeps training on the box. The lid
// opens on "Disconnected"; one click, and everything it printed lands on the downbeat.
export const S3Lid: React.FC = () => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = scene("s3_lid");
    const geo = s.geometry;
    const len = S3.to - S3.from;
    const [c0, c1] = S3.lidClose;
    const [o0, o1] = S3.lidOpen;
    const { click, burst } = S3;
    const reconnectIdx = s.marks.reconnect;
    // the reconnect spinner shows for two captures; the third is where the output arrives
    const burstIdx = reconnectIdx + 3;
    const tClick = frameT(s, reconnectIdx);
    const tBurst = frameT(s, burstIdx);
    const closed = f < o0 ? ramp(f, c0, c1, [0, 1], Ease.exit) : ramp(f, o0, o1, [1, 0], Ease.land);

    let idx = 0;
    if (f >= o0 && f < click) {
        idx = reconnectIdx - 1;
    } else if (f >= click) {
        idx = indexAtTime(
            s,
            mapTime(
                [
                    [click, tClick],
                    [burst - 1, tBurst - 1],
                    [burst, tBurst],
                    [len, tBurst + ((len - burst) / fps) * 1000],
                ],
                f
            )
        );
    }

    const rc = s.reconnectButton;
    const rowY = (r: number) => geo.y + geo.cellH * (r + 0.5);
    const logX = geo.x + 230;
    // after the burst the last epoch line sits just above the cursor row
    const tailRow = 33;
    const keys: CamKey[] = [
        { f: 0, x: logX - 10, y: geo.y + ACTION_BAR + geo.cellH * 12, z: 2.05 },
        { f: c1, x: logX + 60, y: geo.y + ACTION_BAR + geo.cellH * 10, z: 1.7, ease: Ease.glide },
        // wide enough for the banner, the Reconnect button and the log at once
        { f: o0, x: 800, y: 280, z: 1.06 },
        { f: click - 4, x: 820, y: 262, z: 1.1, ease: Ease.glide },
        { f: burst - 6, x: 812, y: 270, z: 1.09, ease: Ease.glide },
        { f: burst + 26, x: logX, y: rowY(tailRow - 5), z: 2.45, ease: Ease.move },
        { f: len, x: logX, y: rowY(tailRow - 2), z: 2.7, ease: Ease.linear },
    ];
    const cam = cameraAt(keys, f);
    const pointer = cursorAt(
        [
            { f: o1 - 26, x: rc.x - 300, y: rc.y + 220 },
            { f: click, x: rc.x, y: rc.y + 3, dur: 44, click: true },
        ],
        f,
        fps
    );
    const pointerOpacity = f < o1 - 26 ? 0 : ramp(f, o1 - 26, o1 - 12, [0, 1]) * ramp(f, click + 16, click + 34, [1, 0]);
    const streak = ramp(f, burst, burst + 9, [0, 1], Ease.linear);
    const streakRect = { x: 0, y: geo.y + ACTION_BAR + geo.cellH * 13, w: 1550, h: geo.cellH * 22 };
    return (
        <AbsoluteFill>
            <Lid closed={closed}>
                <Backdrop lift={1 - closed} />
                <Stage cam={cam}>
                    <CaptureWindow scene={s} index={idx} glow={0.5} />
                    <Streak src={frameSrc(s, burstIdx)} rect={streakRect} progress={streak} travel={geo.cellH * 10} bg="#0e0e0e" />
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} opacity={pointerOpacity} size={17} />
                </Stage>
            </Lid>
        </AbsoluteFill>
    );
};
