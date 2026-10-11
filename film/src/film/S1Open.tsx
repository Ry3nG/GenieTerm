import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { S1 } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { clipIndex, frameT } from "../lib/clip";
import { CaptureWindow, scene, TermRow } from "../lib/frames";
import { Ease, ramp } from "../lib/motion";
import { Spot } from "../lib/spot";
import { typedCount } from "../lib/typing";

const Blue = "#5fafff";
const Fg = "#d4d4d4";
const TermBg = "#0e0e0e";

// Cold open: one caret in the dark, the first command typed at the size of a title, then the
// camera falls back and the type turns out to be a terminal in a real window.
export const S1Open: React.FC = () => {
    const f = useCurrentFrame();
    const s = scene("s1_open");
    const geo = s.geometry;
    const typing = S1.typing;
    const n = typedCount(typing, f);
    const enterIdx = s.marks.enter;
    const tEnter = frameT(s, enterIdx);
    const idx = clipIndex(s, f, typing, [
        [typing.enter, tEnter],
        [typing.enter + 600, tEnter + 10000],
    ]);

    const prompt = "~ $ ";
    const caretCol = prompt.length + n;
    const rowY = geo.y + geo.cellH / 2;
    // the camera leads the caret a little so the line grows toward the center
    const followX = (frame: number) => geo.x + geo.cellW * (prompt.length + typedCount(typing, frame) * 0.92 + 0.5) - 6;
    const keys: CamKey[] = [
        { f: 0, x: followX(0) - 30, y: rowY, z: 7.6 },
        { f: typing.start, x: followX(typing.start), y: rowY, z: 7.0, ease: Ease.glide },
        ...typing.chars.map((c, i) => ({ f: c + 4, x: followX(c + 4), y: rowY, z: 7.0 - (i / typing.chars.length) * 0.5, ease: Ease.glide })),
        { f: typing.enter, x: followX(typing.enter), y: rowY, z: 6.4, ease: Ease.glide },
        { f: typing.enter + 70, ...Home, y: 380, z: 0.88, rx: 9, ry: -13, rz: 1.4, ease: Ease.whip },
        { f: S1.to - S1.from, ...Home, z: 1, ease: Ease.land },
    ];
    const cam = cameraAt(keys, f);
    // the vector line leaves on the Enter frame: the real UI shifts down a row of chrome as
    // the command starts, and a fade would show the line twice
    const vector = f < typing.enter ? ramp(cam.z, 1.9, 3.2, [0, 1], Ease.linear) : 0;
    // a real caret blinks at about 530 ms; it holds steady while keys are coming in
    const caretOn = f < typing.start ? Math.floor(f / 32) % 2 === 0 : f < typing.enter;
    const spot = ramp(f, typing.enter - 2, typing.enter + 14, [1, 0], Ease.glide);
    const fadeIn = ramp(f, 0, 50, [0, 1], Ease.reveal);
    const windowLift = ramp(f, typing.enter, typing.enter + 70, [0, 1], Ease.reveal);

    return (
        <AbsoluteFill>
            <Backdrop lift={windowLift} />
            <AbsoluteFill style={{ opacity: fadeIn }}>
                <Stage cam={cam}>
                    <CaptureWindow scene={s} index={idx} glow={0.5 * windowLift} />
                    <TermRow
                        geo={geo}
                        row={0}
                        spans={[
                            { text: "~", color: Blue },
                            { text: " $ ", color: Fg },
                            { text: typing.text.slice(0, n), color: Fg },
                        ]}
                        bg={TermBg}
                        cover={40}
                        caret={{ col: caretCol, color: "#e6e6e6", on: caretOn }}
                        opacity={vector}
                    />
                </Stage>
                <Spot amount={spot} />
            </AbsoluteFill>
        </AbsoluteFill>
    );
};
