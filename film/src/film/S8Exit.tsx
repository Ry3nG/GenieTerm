import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { S8 } from "../edl";
import { Backdrop } from "../lib/backdrop";
import { cameraAt, type CamKey, Home, Stage } from "../lib/camera";
import { clipIndex, frameT } from "../lib/clip";
import { CaptureWindow, scene, TermRow } from "../lib/frames";
import { Ease, ramp } from "../lib/motion";
import { Spot } from "../lib/spot";
import { typedCount } from "../lib/typing";

const Green = "#87d787";
const Blue = "#5fafff";
const Fg = "#d4d4d4";

// The last command is the shortest. On Enter the window falls back into the dark.
export const S8Exit: React.FC = () => {
    const f = useCurrentFrame();
    const s = scene("s8_exit");
    const geo = s.geometry;
    const typing = S8.typing;
    const len = S8.to - S8.from;
    const n = typedCount(typing, f);
    const idx = clipIndex(s, f, typing, [[typing.enter, frameT(s, s.marks.enter)]]);
    const rowY = geo.y + geo.cellH / 2;
    const prompt = "ml@gpu-box ~/llm $ ";
    const textX = geo.x + geo.cellW * ((prompt.length + 4) / 2);
    const keys: CamKey[] = [
        { f: 0, x: textX + 10, y: rowY, z: 4.6 },
        { f: typing.enter, x: textX + 30, y: rowY, z: 4.9, ease: Ease.glide },
        { f: len, ...Home, z: 0.32, rx: 4, ease: Ease.exit },
    ];
    const cam = cameraAt(keys, f);
    const fade = ramp(f, typing.enter + 8, len, [1, 0], Ease.exit);
    const vector = f < typing.enter ? ramp(cam.z, 1.9, 3.2, [0, 1], Ease.linear) : 0;
    return (
        <AbsoluteFill>
            <Backdrop lift={fade} />
            <AbsoluteFill style={{ opacity: fade }}>
                <Stage cam={cam}>
                    <CaptureWindow scene={s} index={idx} glow={0.4} />
                    <TermRow
                        geo={geo}
                        row={0}
                        spans={[
                            { text: "ml@gpu-box", color: Green },
                            { text: " " },
                            { text: "~/llm", color: Blue },
                            { text: " $ ", color: Fg },
                            { text: typing.text.slice(0, n), color: Fg },
                        ].map((sp) => ({ color: Fg, ...sp }))}
                        bg="#0e0e0e"
                        cover={40}
                        caret={{ col: prompt.length + n, color: "#e6e6e6", on: f < typing.enter }}
                        opacity={vector}
                    />
                </Stage>
                <Spot amount={ramp(f, 0, 30, [0, 1], Ease.reveal)} />
            </AbsoluteFill>
        </AbsoluteFill>
    );
};
