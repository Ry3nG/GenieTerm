import React from "react";
import { AbsoluteFill } from "remotion";
import { LaptopScene } from "./Laptop3D";
import { type CamPose, type Pt, facing, lerpQuad, projectScreen, quadMatrix } from "./project";
import { FRAME_H, FRAME_W } from "./stage";
import { Easing } from "remotion";

// The device shot: the 3D laptop with the screen's content as a DOM layer warped onto the
// glass. `land` (0..1) pulls the layer's corners onto `target`, a flat rectangle in the frame,
// so a push-in can hand over to the flat UI camera without a cut.

export const SCREEN_DOM_W = 1600;
export const SCREEN_DOM_H = 900;

export const LaptopShot: React.FC<{
    pose: CamPose;
    lid: number;
    glow: number;
    room?: number;
    screen: React.ReactNode;
    land?: number;
    target?: Pt[];
    // how much of the 3D scene shows; 0 once the flat UI owns the frame
    device?: number;
    // once the screen fills the frame its background continues past the glass to the edges
    bleed?: { color: string; amount: number };
}> = ({ pose, lid, glow, room = 1, screen, land = 0, target, device = 1, bleed }) => {
    const quad = projectScreen(pose, lid, FRAME_W, FRAME_H);
    const q = target && land > 0 ? lerpQuad(quad, target, land) : quad;
    const visible = facing(quad) > 0 && glow > 0.001;
    // the content fades with the display; a sleeping screen is just glass
    const contentAlpha = Math.min(1, glow * 1.4);
    return (
        <AbsoluteFill>
            {device > 0 && (
                <AbsoluteFill style={{ opacity: device }}>
                    <LaptopScene lid={lid} glow={glow} pose={pose} width={FRAME_W} height={FRAME_H} room={room} />
                </AbsoluteFill>
            )}
            {bleed && bleed.amount > 0 && <AbsoluteFill style={{ background: bleed.color, opacity: bleed.amount }} />}
            {visible && (
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: SCREEN_DOM_W,
                        height: SCREEN_DOM_H,
                        transformOrigin: "0 0",
                        transform: quadMatrix(SCREEN_DOM_W, SCREEN_DOM_H, q),
                        opacity: contentAlpha,
                        overflow: "hidden",
                        backfaceVisibility: "hidden",
                    }}
                >
                    {screen}
                </div>
            )}
        </AbsoluteFill>
    );
};

// The lid closing the way a hand closes a good laptop: a small lift, a swing that gathers
// speed, then the hinge and magnet catch it so it lands softly, with the faintest settle.
// 0 = open, 1 = shut.
const fall = Easing.bezier(0.45, 0, 0.5, 1);
export const LidFrames = { lift: 7, fall: 40, settle: 14, open: 54 };

export function lidClose(frame: number, start: number): number {
    const t = frame - start;
    if (t <= 0) {
        return 0;
    }
    if (t < LidFrames.lift) {
        return -0.022 * Math.sin((t / LidFrames.lift) * Math.PI * 0.5);
    }
    const u = t - LidFrames.lift;
    if (u < LidFrames.fall) {
        return -0.022 + 1.022 * fall(u / LidFrames.fall);
    }
    const r = u - LidFrames.fall;
    if (r < LidFrames.settle) {
        return 1 - 0.004 * Math.sin((r / LidFrames.settle) * Math.PI) * Math.exp(-r / 6);
    }
    return 1;
}

// The frame (relative to start) on which the lid meets the base: the sound's hit point.
export const lidContact = () => LidFrames.lift + LidFrames.fall;

// Opening: lifted off the magnet, swung up, settling a touch past and back.
const swing = Easing.bezier(0.3, 0, 0.15, 1);
export function lidOpen(frame: number, start: number): number {
    const t = frame - start;
    if (t <= 0) {
        return 1;
    }
    if (t >= LidFrames.open + 20) {
        return 0;
    }
    if (t < LidFrames.open) {
        return 1 - 1.012 * swing(t / LidFrames.open);
    }
    const r = (t - LidFrames.open) / 20;
    return -0.012 * (1 - Easing.bezier(0.4, 0, 0.2, 1)(r));
}
