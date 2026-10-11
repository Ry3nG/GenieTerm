import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { MonoFamily, SansFamily } from "../lib/fonts";
import { IconMoon, IconServer } from "../kit/icons";
import { Label } from "../kit/label";
import { LaptopShot, lidClose, lidContact, lidOpen } from "../kit/laptopshot";
import { Ease, mix, ramp } from "../kit/motion";
import { BASE, type CamPose, distanceForFill, frontalPose, lerpPose, makeCamera, rectQuad } from "../kit/project";
import { FRAME_H, FRAME_W, Studio, World, camPath, recede, toScreen, withDrift } from "../kit/stage";
import { T } from "../kit/tokens";
import { CmdBar, WIN_H, WIN_W, formatDuration } from "../kit/ui";
import * as THREE from "three";
import { DevicePose } from "./ColdOpen";
import { BarCam, BlockSpotlight, type LinkState, Scrim, TrainLayout, TrainingWindow, barWorld } from "./workspace";

// The hero: the cold open's exact shot, with GenieTerm on the screen. The lid closes, the
// night passes while the server keeps counting, the lid opens, and we land back on the same
// block, same framing, hours later.

export const D = {
    pull: 40,
    handoff: 196,
    reveal: [196, 330] as const,
    close: 340,
    server: 410,
    count: [440, 660] as const,
    open: 690,
    reconnected: 760,
    push: [790, 910] as const,
    land: 920,
    label: 968,
    end: 1120,
};

const FULL = { x: WIN_W / 2, y: WIN_H / 2, zoom: FRAME_W / WIN_W };
const FULL_RECT = rectQuad(FRAME_W / 2 - (WIN_W * FULL.zoom) / 2, FRAME_H / 2 - (WIN_H * FULL.zoom) / 2, WIN_W * FULL.zoom, WIN_H * FULL.zoom);
const FRONT: CamPose = frontalPose(0, distanceForFill(24, 1.0), 24);
// while the laptop sleeps the camera eases back and left so the server has its own space
const NIGHT: CamPose = { pos: [-34, 30, 78], look: [10, 3, -3], fov: 24 };

const START_EPOCH = 41;
const END_EPOCH = 87;
const START_S = 42 * 60 + 17;
const END_S = 7 * 3600 + 6 * 60;

function progressAt(f: number) {
    const t = ramp(f, D.count[0], D.count[1], Ease.move);
    return { epoch: Math.round(mix(START_EPOCH, END_EPOCH, t)), seconds: mix(START_S, END_S, t) };
}

const ServerCard: React.FC<{ x: number; y: number; epoch: number; seconds: number; alpha: number }> = ({ x, y, epoch, seconds, alpha }) => (
    <div
        style={{
            position: "absolute",
            left: x,
            top: y,
            width: 380,
            padding: "20px 22px 20px",
            borderRadius: 18,
            background: "rgba(28,28,30,0.88)",
            border: "1px solid rgba(255,255,255,0.09)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
            opacity: alpha,
            transform: `translateY(${(1 - alpha) * 16}px) scale(1.35)`,
            transformOrigin: "0 0",
        }}
    >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "#1b2a40", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IconServer size={18} color="#4d8dff" />
            </div>
            <div>
                <div style={{ fontFamily: SansFamily, fontSize: 20, fontWeight: 600, color: T.fg, letterSpacing: "-0.01em" }}>atlas</div>
                <div style={{ fontFamily: MonoFamily, fontSize: 14, color: T.secondary }}>python train.py</div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: SansFamily, fontSize: 13, fontWeight: 500, color: "#7fd18a" }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: "#5fbf6a", boxShadow: "0 0 8px rgba(95,191,106,0.8)" }} />
                Running
            </div>
        </div>
        <div style={{ marginTop: 18, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{ width: `${epoch}%`, height: "100%", borderRadius: 3, background: T.accent }} />
        </div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontFamily: SansFamily, fontSize: 15, color: T.secondary, fontVariantNumeric: "tabular-nums" }}>
            <span>
                epoch <span style={{ color: T.fg, fontWeight: 600 }}>{epoch}</span> / 100
            </span>
            <span>{formatDuration(seconds)}</span>
        </div>
    </div>
);

function projectPoint(pose: CamPose, x: number, y: number, z: number) {
    const cam = makeCamera(pose, FRAME_W, FRAME_H);
    const p = new THREE.Vector3(x, y, z).project(cam);
    return { x: ((p.x + 1) / 2) * FRAME_W, y: ((1 - p.y) / 2) * FRAME_H };
}

// Anchor of the link on the laptop: the back of the base, which stays put while the lid moves.
const laptopAnchor = (pose: CamPose) => projectPoint(pose, BASE.w / 2 - 3, BASE.h, -BASE.d / 2 + 2);

export const Durable: React.FC = () => {
    const f = useCurrentFrame();
    const { epoch, seconds } = progressAt(f);
    const fadeIn = ramp(f, 0, 30, Ease.glide);

    // ---- flat UI camera before the hand-off and after the landing ----
    const before = f < D.handoff;
    const after = f >= D.land;
    const uiCam = before
        ? camPath(f, [
              { at: 0, ...BarCam },
              { at: D.pull, ...FULL },
          ])
        : camPath(f, [
              { at: D.land, ...FULL },
              { at: D.land + 4, ...BarCam },
          ]);
    // no drift where the flat window must line up with the glass
    const driftAmt = before ? 1 - ramp(f, D.pull, D.pull + 100, Ease.linear) : ramp(f, D.land + 60, D.land + 140, Ease.linear);
    const cam = withDrift(uiCam, f, driftAmt);

    // ---- device ----
    const closing = f < D.open;
    const lid = f < D.close ? 0 : closing ? lidClose(f, D.close) : lidOpen(f, D.open);
    const contact = D.close + lidContact();
    const glow = closing ? 1 - ramp(lid, 0.8, 1, Ease.linear) : ramp(f, D.open + 10, D.open + 40, Ease.out);
    const room = f < contact ? 1 : f < D.open - 20 ? mix(1, 0.12, ramp(f, contact + 4, contact + 70, Ease.out)) : mix(0.12, 0.9, ramp(f, D.open - 20, D.open + 60, Ease.move));
    const revealT = ramp(f, D.reveal[0], D.reveal[1], Ease.camera);
    const pushT = ramp(f, D.push[0], D.push[1], Ease.camera);
    const nightT = ramp(f, D.close + 30, D.server + 90, Ease.move) * (1 - ramp(f, D.open - 40, D.push[0], Ease.move));
    const devicePose = lerpPose(DevicePose.near, NIGHT, nightT);
    const pose = f < D.push[0] ? lerpPose(FRONT, devicePose, revealT) : lerpPose(devicePose, FRONT, pushT);
    const land = f < D.push[0] ? 1 - revealT : ramp(f, D.push[0] + 40, D.push[1], Ease.camera);
    const device = f < D.push[0] ? ramp(f, D.reveal[0], D.reveal[0] + 30, Ease.linear) : 1 - ramp(f, D.push[1] - 10, D.push[1], Ease.linear);

    const link: LinkState = f < D.open ? { kind: "live" } : f < D.reconnected ? { kind: "reconnecting" } : { kind: "reconnected", t: f - D.reconnected };
    const screen = <TrainingWindow frame={f} epoch={epoch} seconds={seconds} link={link} radius={0} />;

    // ---- the night: server card, link, captions ----
    const serverIn = ramp(f, D.server, D.server + 40, Ease.enter) * (1 - ramp(f, D.reconnected + 6, D.push[0] + 6, Ease.exit));
    const anchor = laptopAnchor(pose);
    const cardPos = { x: 1250, y: 330 };
    const front = projectPoint(pose, 0, -BASE.h / 2, BASE.d / 2 + 4);
    const linkEnd = { x: cardPos.x, y: cardPos.y + 80 };
    const linkAlpha = ramp(f, D.reveal[1] - 40, D.reveal[1], Ease.out) * (1 - ramp(f, D.reconnected + 6, D.push[0] + 6, Ease.exit));
    const asleep = f >= contact && f < D.open + 10;
    const pulse = ramp(f, D.open + 30, D.reconnected, Ease.move);
    const moon = ramp(f, contact + 20, contact + 60, Ease.enter) * (1 - ramp(f, D.open - 10, D.open + 10, Ease.exit));

    // ---- label on landing ----
    const spot = ramp(f, D.label - 24, D.label + 16, Ease.move);
    const bw = barWorld();
    const barScreen = toScreen(cam, bw.x, bw.y);
    const bar = <CmdBar command="python train.py" state={{ kind: "running", seconds }} frame={f} />;

    const flat = (
        <World cam={cam}>
            <div style={{ position: "absolute", left: 0, top: 0, width: WIN_W, height: WIN_H, borderRadius: 12, boxShadow: "0 60px 160px rgba(0,0,0,0.7)" }}>
                <TrainingWindow frame={f} epoch={epoch} seconds={seconds} link={link} radius={before ? mix(12, 0, ramp(f, D.pull, D.handoff, Ease.linear)) : mix(0, 12, ramp(f, D.land, D.land + 40, Ease.linear))} />
            </div>
        </World>
    );

    const exit = ramp(f, D.end - 34, D.end - 2, Ease.glide);
    return (
        <AbsoluteFill style={{ background: "#000", opacity: fadeIn * (1 - exit), transform: `scale(${1 - exit * 0.025})`, filter: `blur(${exit * 6}px)` }}>
            {before || after ? (
                <>
                    <Studio />
                    <AbsoluteFill style={recede(after ? spot : 0)}>{flat}</AbsoluteFill>
                    {after && (
                        <>
                            <BlockSpotlight cam={cam} amount={spot} bar={bar} rect={TrainLayout.term()} />
                            <Scrim x={barScreen.x} y={barScreen.y + 150} w={760} h={140} amount={spot} />
                            <Label frame={f} x={barScreen.x + 4} y={barScreen.y + 34 * cam.zoom + 44} text="Still running. Nothing lost." sub="Close the lid, lose Wi-Fi, switch networks. The session waits." from={D.label} to={D.end + 10} />
                        </>
                    )}
                </>
            ) : (
                <>
                    <Studio light={room} />
                    <LaptopShot pose={pose} lid={lid} glow={glow} room={room} land={land} target={FULL_RECT} device={device} screen={screen} />
                    <svg width={FRAME_W} height={FRAME_H} style={{ position: "absolute", left: 0, top: 0, opacity: linkAlpha }}>
                        <defs>
                            <linearGradient id="linkGrad" x1={anchor.x} y1={anchor.y} x2={linkEnd.x} y2={linkEnd.y} gradientUnits="userSpaceOnUse">
                                <stop offset="0" stopColor={T.accent} stopOpacity={asleep ? 0.12 : 0.55} />
                                <stop offset="1" stopColor={T.accent} stopOpacity={0.8} />
                            </linearGradient>
                        </defs>
                        <path
                            d={`M ${anchor.x} ${anchor.y} C ${anchor.x + 160} ${anchor.y - 60}, ${linkEnd.x - 200} ${linkEnd.y}, ${linkEnd.x} ${linkEnd.y}`}
                            fill="none"
                            stroke="url(#linkGrad)"
                            strokeWidth={2}
                            strokeDasharray={asleep ? "3 9" : "none"}
                            strokeDashoffset={-f * 0.6}
                        />
                    </svg>
                    <PulseDot from={linkEnd} to={anchor} t={pulse} />
                    <ServerCard x={cardPos.x} y={cardPos.y} epoch={epoch} seconds={seconds} alpha={serverIn} />
                    {moon > 0 && (
                        <div style={{ position: "absolute", left: front.x - 120, top: front.y + 10, width: 240, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: moon * 0.8, fontFamily: SansFamily, fontSize: 24, fontWeight: 500, color: T.secondary }}>
                            <IconMoon size={20} color={T.secondary} />
                            Asleep
                        </div>
                    )}
                </>
            )}
        </AbsoluteFill>
    );
};

// The reconnect, drawn as one bright point running from the server back to the laptop.
const PulseDot: React.FC<{ from: { x: number; y: number }; to: { x: number; y: number }; t: number }> = ({ from, to, t }) => {
    if (t <= 0 || t >= 1) {
        return null;
    }
    // same cubic as the link, walked backwards
    const P0 = to;
    const P1 = { x: to.x + 160, y: to.y - 60 };
    const P2 = { x: from.x - 200, y: from.y };
    const P3 = from;
    const u = 1 - t;
    const b = (a: number, c1: number, c2: number, d: number) => (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * c1 + 3 * (1 - u) * u * u * c2 + u ** 3 * d;
    const x = b(P0.x, P1.x, P2.x, P3.x);
    const y = b(P0.y, P1.y, P2.y, P3.y);
    const a = Math.sin(t * Math.PI);
    return <div style={{ position: "absolute", left: x - 6, top: y - 6, width: 12, height: 12, borderRadius: 6, background: "#8cc8ff", boxShadow: "0 0 18px 6px rgba(41,151,255,0.7)", opacity: a }} />;
};
