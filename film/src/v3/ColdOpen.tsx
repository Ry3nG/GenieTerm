import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { epochLine } from "../kit/data";
import { LaptopShot, lidClose, lidContact, lidOpen } from "../kit/laptopshot";
import { Ease, mix, ramp } from "../kit/motion";
import { PlainTerminal } from "../kit/plainterm";
import { type CamPose, distanceForFill, frontalPose, lerpPose, rectQuad } from "../kit/project";
import { Studio } from "../kit/stage";
import { type Line, md } from "../kit/ui";

// The pain, before any product: an ordinary terminal over SSH, running either a training job
// or a coding agent. The lid closes, time passes, the lid opens, and the camera pushes into the
// screen to read what happened. The same shot comes back later with GenieTerm on the screen.

export type ColdStory = "train" | "agent";

export const ColdTimes = {
    close: 150,
    dark: [196, 300] as const,
    open: 300,
    push: [380, 500] as const,
    // once the glass fills the frame the device is gone; the rest of the move is flat
    zoom: [500, 560] as const,
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

const PROMPT = "you@laptop ~ % ";
const login: Line[] = [
    md("Last login: Sat Oct 10 21:02:44 on ttys002"),
    md("you@laptop ~ % ssh atlas"),
    md("Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-49-generic x86_64)"),
];

const LAST_EPOCH = 14;
const AGENT_BOX = 66;
const agentHead: Line[] = [
    md("ml@atlas:~/llm$ claude"),
    md(""),
    md(`{d}╭${"─".repeat(AGENT_BOX)}╮{/}`),
    md(`{d}│{/} > Switch train.py to bf16 autocast and get the tests passing${" ".repeat(AGENT_BOX - 61)}{d}│{/}`),
    md(`{d}╰${"─".repeat(AGENT_BOX)}╯{/}`),
    md(""),
];
const agentWork: Line[] = [
    md("{a}●{/} Read(train.py)"),
    md("{a}●{/} Update(train.py)"),
    md("  {d}⎿  Wrapped the forward pass in torch.autocast(bfloat16){/}"),
    md("{a}●{/} Bash(pytest -q)"),
];

// What the screen shows: the session as it runs, then what is left of it after the lid opens.
function screenLines(story: ColdStory, f: number, after: boolean): Line[] {
    if (story === "train") {
        const lines: Line[] = [...login, md("ml@atlas:~/llm$ python train.py"), md("model 58M params · 1× RTX 5090 · bf16")];
        const upTo = after ? LAST_EPOCH : Math.min(LAST_EPOCH, 8 + Math.floor(f / 24));
        for (let e = 1; e <= upTo; e++) {
            lines.push(epochLine(e));
        }
        return lines;
    }
    const shown = after ? agentWork.length : Math.min(agentWork.length, 1 + Math.floor(f / 36));
    const spin = ["·", "✢", "✳", "✶", "✻", "✽"][Math.floor(f / 8) % 6];
    return [...login, ...agentHead, ...agentWork.slice(0, shown), md(`  {a}${after ? "✻" : spin}{/} {d}Running…{/}`)];
}

const errorRow = (story: ColdStory) => screenLines(story, 0, true).length;

// Where the push-in lands: the error and the prompt large, a little left of centre.
const K = 2.6;
function landRect(story: ColdStory) {
    const focusY = TOP + (errorRow(story) + 1) * LH;
    return { x: 250 - LEFT * K, y: 560 - focusY * K, w: 1600 * K, h: 900 * K };
}

// The caret a following scene can pick up: its rectangle in frame pixels at the end.
export function coldCaret(story: ColdStory) {
    const r = landRect(story);
    return {
        x: r.x + (LEFT + PROMPT.length * CHAR) * K,
        y: r.y + (TOP + (errorRow(story) + 1) * LH + 1) * K,
        w: CHAR * K,
        h: (LH - 3) * K,
    };
}
export const ColdCaret = coldCaret("train");

export const ColdOpen: React.FC<{ story?: ColdStory; keepCaret?: boolean }> = ({ story = "train", keepCaret = true }) => {
    const f = useCurrentFrame();
    const rect = landRect(story);
    const caretRect = coldCaret(story);
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
    const land = ramp(f, T.zoom[0], T.zoom[1], Ease.camera);

    const after = f >= T.open;
    const lines: Line[] = screenLines(story, f, after);
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
                <AbsoluteFill style={{ opacity: f >= T.zoom[0] ? textFade : 1 }}>
                    <Studio light={room} />
                </AbsoluteFill>
                <LaptopShot
                    pose={pose}
                    lid={lid}
                    glow={glow}
                    room={room}
                    land={land}
                    target={rectQuad(rect.x, rect.y, rect.w, rect.h)}
                    device={f < T.zoom[0] ? 1 : 0}
                    bleed={{ color: "#1c1c1e", amount: (f < T.zoom[0] ? 0 : 1) * textFade }}
                    screen={
                        <div style={{ position: "absolute", inset: 0, opacity: textFade }}>
                            <PlainTerminal lines={lines} caret={after && f < T.zoom[1] ? caretOn : 0} size={SIZE} />
                        </div>
                    }
                />
            </AbsoluteFill>
            {/* the caret is drawn in frame space once landed so it can survive the fade */}
            {f >= T.zoom[1] && (
                <div style={{ position: "absolute", left: caretRect.x, top: caretRect.y, width: caretRect.w, height: caretRect.h, background: "#d0d0d0", opacity: caretOn * (keepCaret ? 1 : textFade) }} />
            )}
        </AbsoluteFill>
    );
};
