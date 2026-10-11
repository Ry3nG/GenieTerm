import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { epochLine } from "../kit/data";
import { LaptopShot, lidClose, lidContact, lidOpen } from "../kit/laptopshot";
import { Ease, mix, ramp } from "../kit/motion";
import { PlainTerminal } from "../kit/plainterm";
import { type CamPose, distanceForFill, frontalPose, lerpPose, rectQuad } from "../kit/project";
import { Studio } from "../kit/stage";
import { type Line, md } from "../kit/ui";

// The pain, before any product: an ordinary terminal running a training job over SSH. The lid
// closes, the night passes, the lid opens, and the camera pushes into the screen to read what
// happened. The same shot comes back in "durable" with GenieTerm on the screen.

export const ColdTimes = {
    close: 150,
    dark: [196, 300] as const,
    open: 300,
    push: [380, 520] as const,
    fadeOut: [600, 640] as const,
};

export const DevicePose = {
    wide: { pos: [-44, 30, 76], look: [0, 4.5, -3], fov: 24 } as CamPose,
    near: { pos: [-36, 25, 64], look: [0, 4, -3], fov: 24 } as CamPose,
};

const SIZE = 15;
const LH = Math.round(SIZE * 1.3);
const TOP = 46;
const LEFT = 14;
const CHAR = SIZE * 0.6;

const head: Line[] = [
    md("Last login: Sat Oct 10 21:02:44 on ttys002"),
    md("you@laptop ~ % ssh atlas"),
    md("Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-49-generic x86_64)"),
    md("ml@atlas:~/llm$ python train.py"),
    md("model 58M params · 1× RTX 5090 · bf16"),
];
const LAST_EPOCH = 14;
const ERROR_ROW = head.length + LAST_EPOCH;
const PROMPT = "you@laptop ~ % ";

// Where the push-in lands: the error and the prompt large, a little left of centre.
const K = 2.6;
const focusY = TOP + (ERROR_ROW + 1) * LH;
const landRect = { x: 250 - LEFT * K, y: 560 - focusY * K, w: 1600 * K, h: 900 * K };

// The caret the title scene picks up: its rectangle in frame pixels at the end of this scene.
export const ColdCaret = {
    x: landRect.x + (LEFT + PROMPT.length * CHAR) * K,
    y: landRect.y + (TOP + (ERROR_ROW + 1) * LH + 1) * K,
    w: CHAR * K,
    h: (LH - 3) * K,
};

export const ColdOpen: React.FC = () => {
    const f = useCurrentFrame();
    const T = ColdTimes;
    const closing = f < T.open;
    const lid = closing ? lidClose(f, T.close) : lidOpen(f, T.open);
    const contact = T.close + lidContact();

    // the display sleeps as the lid comes down, and wakes as it lifts
    const glow = closing ? 1 - ramp(lid, 0.8, 1, Ease.linear) : ramp(f, T.open + 10, T.open + 40, Ease.out);
    const room = f < contact ? 1 : f < T.dark[1] - 10 ? mix(1, 0.12, ramp(f, contact + 4, contact + 70, Ease.out)) : mix(0.12, 0.9, ramp(f, T.dark[1] - 10, T.open + 70, Ease.move));

    const pushT = ramp(f, T.push[0], T.push[1], Ease.camera);
    const dolly = lerpPose(DevicePose.wide, DevicePose.near, ramp(f, 0, T.open, Ease.linear));
    const front = frontalPose(0, distanceForFill(24, 1.0), 24);
    const pose = f < T.push[0] ? dolly : lerpPose(DevicePose.near, front, pushT);
    const land = ramp(f, T.push[0] + 40, T.push[1], Ease.camera);

    const ticking = Math.min(LAST_EPOCH, 8 + Math.floor(f / 24));
    const after = f >= T.open;
    const lines: Line[] = [...head];
    for (let e = 1; e <= (after ? LAST_EPOCH : ticking); e++) {
        lines.push(epochLine(e));
    }
    if (after) {
        lines.push(md("client_loop: send disconnect: Broken pipe"));
        lines.push(md(PROMPT));
    }
    const caretOn = after ? 1 : Math.floor(f / 32) % 2 === 0 ? 1 : 0;

    // after the hold, everything but the caret goes dark; the caret carries into the title
    const textFade = 1 - ramp(f, T.fadeOut[0], T.fadeOut[1] - 2, Ease.glide);
    const fadeIn = ramp(f, 0, 50, Ease.out);
    return (
        <AbsoluteFill style={{ background: "#000" }}>
            <AbsoluteFill style={{ opacity: fadeIn }}>
                <AbsoluteFill style={{ opacity: f >= T.push[1] ? textFade : 1 }}>
                    <Studio light={room} />
                </AbsoluteFill>
                <LaptopShot
                    pose={pose}
                    lid={lid}
                    glow={glow}
                    room={room}
                    land={land}
                    target={rectQuad(landRect.x, landRect.y, landRect.w, landRect.h)}
                    device={1 - ramp(f, T.push[1] - 10, T.push[1], Ease.linear)}
                    bleed={{ color: "#1c1c1e", amount: ramp(f, T.push[1] - 30, T.push[1] - 10, Ease.linear) * textFade }}
                    screen={
                        <div style={{ position: "absolute", inset: 0, opacity: textFade }}>
                            <PlainTerminal lines={lines} caret={after && f < T.push[1] ? caretOn : 0} size={SIZE} />
                        </div>
                    }
                />
            </AbsoluteFill>
            {/* the caret is drawn in frame space once landed so it can survive the fade */}
            {f >= T.push[1] && (
                <div style={{ position: "absolute", left: ColdCaret.x, top: ColdCaret.y, width: ColdCaret.w, height: ColdCaret.h, background: "#d0d0d0", opacity: caretOn }} />
            )}
        </AbsoluteFill>
    );
};
