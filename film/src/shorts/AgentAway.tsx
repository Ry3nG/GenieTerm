import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { MonoFamily, SansFamily } from "../lib/fonts";
import { IconCircleCheck, IconMoon, IconServer, IconSpinner } from "../kit/icons";
import { Label } from "../kit/label";
import { LaptopShot, lidClose, lidContact, lidOpen } from "../kit/laptopshot";
import { Ease, FPS, mix, ramp } from "../kit/motion";
import { BASE, lerpPose } from "../kit/project";
import { FRAME_H, FRAME_W, Studio, World, camPath, recede, toScreen, withDrift } from "../kit/stage";
import { T } from "../kit/tokens";
import { CMDBAR_H, HEADER_H, WIN_H, WIN_W, formatDuration } from "../kit/ui";
import { DevicePose } from "../v3/ColdOpen";
import { FRONT, FULL, NIGHT, PulseDot, laptopAnchor, projectPoint } from "../v3/Durable";
import { type LinkState, Scrim, blockOrigin } from "../v3/workspace";
import { AgentLayout, AgentWindow, REQUEST } from "./agent";

// Durable sessions, told with what people actually leave running over SSH: a coding agent.
// The request goes in, the agent starts, the lid closes. While the laptop sleeps the session
// keeps working on the server; open the lid and it has finished, transcript intact.

export const G = {
    type: 14,
    submit: 112,
    step1: 140,
    step2: 182,
    step3: 236,
    pull: 280,
    handoff: 430,
    reveal: [430, 560] as const,
    close: 576,
    server: 650,
    night: [700, 940] as const,
    open: 968,
    reconnected: 1036,
    push: [1066, 1186] as const,
    land: 1196,
    label: 1250,
    end: 1500,
};

const PER_CHAR = 1.55;
const START_S = 3 * 60 + 41;
const END_S = 64 * 60 + 12;

function stepAt(f: number): number {
    if (f < G.step1) return 0;
    if (f < G.step2) return 1;
    if (f < G.step3) return 2;
    if (f < G.night[0]) return 3;
    // overnight, the rest of the work
    const t = ramp(f, G.night[0], G.night[1], Ease.linear);
    return Math.min(8, 4 + Math.floor(t * 5));
}

const NightSteps = [
    { label: "Edit train.py", from: 0 },
    { label: "Run tests · 3 failed", from: 4 },
    { label: "Fix tests/test_loss.py", from: 5 },
    { label: "Run tests · 42 passed", from: 7 },
];

const AgentCard: React.FC<{ x: number; y: number; step: number; seconds: number; frame: number; alpha: number }> = ({ x, y, step, seconds, frame, alpha }) => {
    const done = step >= 8;
    return (
        <div
            style={{
                position: "absolute",
                left: x,
                top: y,
                width: 400,
                padding: "20px 22px",
                borderRadius: 18,
                background: "rgba(28,28,30,0.9)",
                border: "1px solid rgba(255,255,255,0.09)",
                boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
                opacity: alpha,
                transform: `translateY(${(1 - alpha) * 16}px) scale(1.3)`,
                transformOrigin: "0 0",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: "#1b2a40", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <IconServer size={18} color="#4d8dff" />
                </div>
                <div>
                    <div style={{ fontFamily: SansFamily, fontSize: 20, fontWeight: 600, color: T.fg, letterSpacing: "-0.01em" }}>atlas</div>
                    <div style={{ fontFamily: MonoFamily, fontSize: 14, color: T.secondary }}>claude</div>
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: SansFamily, fontSize: 13, fontWeight: 500, color: done ? "#7fd18a" : "#7cc0ff" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: done ? "#5fbf6a" : T.accent, boxShadow: `0 0 8px ${done ? "rgba(95,191,106,0.8)" : "rgba(41,151,255,0.8)"}` }} />
                    {done ? "Done" : "Working"}
                </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 9 }}>
                {NightSteps.map((s, i) => {
                    const next = NightSteps[i + 1]?.from ?? 8;
                    const active = step >= s.from && step < next;
                    const finished = step >= next;
                    const shown = step >= s.from;
                    return (
                        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, opacity: shown ? 1 : 0.28, fontFamily: SansFamily, fontSize: 15, color: finished ? T.secondary : T.fg }}>
                            {finished ? <IconCircleCheck size={15} color="#5fbf6a" /> : active ? <IconSpinner t={frame} size={15} color={T.accent} /> : <span style={{ width: 15, height: 15, borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.25)" }} />}
                            {s.label}
                        </div>
                    );
                })}
            </div>
            <div style={{ marginTop: 14, fontFamily: SansFamily, fontSize: 14, color: T.muted, fontVariantNumeric: "tabular-nums" }}>Running {formatDuration(seconds)}</div>
        </div>
    );
};

export const AgentAway: React.FC = () => {
    const f = useCurrentFrame();
    const fadeIn = ramp(f, 0, 30, Ease.glide);
    const typedN = Math.max(0, Math.min(REQUEST.length, Math.floor((f - G.type) / PER_CHAR)));
    const typed = REQUEST.slice(0, typedN);
    const step = stepAt(f);
    const seconds = f < G.night[0] ? START_S + f / FPS : mix(START_S + G.night[0] / FPS, END_S, ramp(f, G.night[0], G.night[1], Ease.move)) + Math.max(0, f - G.night[1]) / FPS;
    const edited = step >= 2;
    const flash = ramp(f, G.step2, G.step2 + 10, Ease.out) * (1 - ramp(f, G.step2 + 30, G.step2 + 90, Ease.move));
    const caret = f < G.submit ? 1 : 0;

    // ---- flat UI camera ----
    const before = f < G.handoff;
    const after = f >= G.land;
    const termO = blockOrigin(AgentLayout.term());
    const textY = termO.y + HEADER_H + CMDBAR_H + 14;
    const uiCam = before
        ? camPath(f, [
              { at: 0, x: 300, y: 190, zoom: 2.25 },
              { at: G.step2 - 30, x: 700, y: 330, zoom: 1.4 },
              { at: G.pull, ...FULL },
          ])
        : camPath(f, [
              { at: G.land, ...FULL },
              { at: G.land + 4, x: 330, y: textY + 13 * 15 - 20, zoom: 2.3 },
          ]);
    const driftAmt = before ? 1 - ramp(f, G.pull, G.pull + 100, Ease.linear) : ramp(f, G.land + 60, G.land + 140, Ease.linear);
    const cam = withDrift(uiCam, f, driftAmt);

    // ---- device ----
    const closing = f < G.open;
    const lid = f < G.close ? 0 : closing ? lidClose(f, G.close) : lidOpen(f, G.open);
    const contact = G.close + lidContact();
    const glow = closing ? 1 - ramp(lid, 0.8, 1, Ease.linear) : ramp(f, G.open + 10, G.open + 40, Ease.out);
    const room = f < contact ? 1 : f < G.open - 20 ? mix(1, 0.12, ramp(f, contact + 4, contact + 70, Ease.out)) : mix(0.12, 0.9, ramp(f, G.open - 20, G.open + 60, Ease.move));
    const revealT = ramp(f, G.reveal[0], G.reveal[1], Ease.camera);
    const pushT = ramp(f, G.push[0], G.push[1], Ease.camera);
    const nightT = ramp(f, G.close + 30, G.server + 90, Ease.move) * (1 - ramp(f, G.open - 40, G.push[0], Ease.move));
    const devicePose = lerpPose(DevicePose.near, NIGHT, nightT);
    const pose = f < G.push[0] ? lerpPose(FRONT, devicePose, revealT) : lerpPose(devicePose, FRONT, pushT);

    const link: LinkState = f < G.open ? { kind: "live" } : f < G.reconnected ? { kind: "reconnecting" } : { kind: "reconnected", t: f - G.reconnected };
    const win = (radius: number) => <AgentWindow frame={f} typed={typed} step={step} seconds={seconds} edited={edited} flash={flash} link={link} radius={radius} caret={caret} />;

    // ---- away: the server card, the link, the laptop asleep ----
    const serverIn = ramp(f, G.server, G.server + 40, Ease.enter) * (1 - ramp(f, G.reconnected + 6, G.push[0] + 6, Ease.exit));
    const anchor = laptopAnchor(pose);
    const cardPos = { x: 1220, y: 300 };
    const front = projectPoint(pose, 0, -BASE.h / 2, BASE.d / 2 + 4);
    const linkEnd = { x: cardPos.x, y: cardPos.y + 80 };
    const linkAlpha = ramp(f, G.reveal[1] - 40, G.reveal[1], Ease.out) * (1 - ramp(f, G.reconnected + 6, G.push[0] + 6, Ease.exit));
    const asleep = f >= contact && f < G.open + 10;
    const pulse = ramp(f, G.open + 30, G.reconnected, Ease.move);
    const moon = ramp(f, contact + 20, contact + 60, Ease.enter) * (1 - ramp(f, G.open - 10, G.open + 10, Ease.exit));

    // ---- landing: the last lines of the transcript, lifted over the receded window ----
    const spot = ramp(f, G.label - 24, G.label + 16, Ease.move);
    const bandWorld = { x: termO.x + 4, y: textY + 13 * 15 - 2, w: 640, h: 4 * 15 + 6 };
    const tl = toScreen(cam, bandWorld.x, bandWorld.y);
    const br = toScreen(cam, bandWorld.x + bandWorld.w, bandWorld.y + bandWorld.h);

    const flat = (radius: number) => (
        <World cam={cam}>
            <div style={{ position: "absolute", left: 0, top: 0, width: WIN_W, height: WIN_H, borderRadius: 12, boxShadow: "0 60px 160px rgba(0,0,0,0.7)" }}>{win(radius)}</div>
        </World>
    );
    const exit = ramp(f, G.end - 34, G.end - 2, Ease.glide);
    return (
        <AbsoluteFill style={{ background: "#000", opacity: fadeIn * (1 - exit), transform: `scale(${1 - exit * 0.025})`, filter: `blur(${exit * 6}px)` }}>
            {before || after ? (
                <>
                    <Studio />
                    <AbsoluteFill style={recede(after ? spot * 1.2 : 0)}>{flat(before ? mix(12, 0, ramp(f, G.pull, G.handoff, Ease.linear)) : mix(0, 12, ramp(f, G.land, G.land + 40, Ease.linear)))}</AbsoluteFill>
                    {after && spot > 0 && (
                        <>
                            <AbsoluteFill style={{ clipPath: `inset(${tl.y}px ${FRAME_W - br.x}px ${FRAME_H - br.y}px ${tl.x}px round 14px)`, opacity: spot }}>{flat(12)}</AbsoluteFill>
                            <Scrim x={tl.x} y={tl.y - 150} w={760} h={120} amount={spot} />
                            <Label frame={f} x={tl.x + 10} y={tl.y - 168} text="It finished while you were away." sub="Sessions live on the server. No tmux needed." from={G.label} to={G.end + 10} />
                        </>
                    )}
                </>
            ) : (
                <>
                    <Studio light={room} />
                    <LaptopShot pose={pose} lid={lid} glow={glow} room={room} screen={win(0)} />
                    <svg width={FRAME_W} height={FRAME_H} style={{ position: "absolute", left: 0, top: 0, opacity: linkAlpha }}>
                        <defs>
                            <linearGradient id="agentLink" x1={anchor.x} y1={anchor.y} x2={linkEnd.x} y2={linkEnd.y} gradientUnits="userSpaceOnUse">
                                <stop offset="0" stopColor={T.accent} stopOpacity={asleep ? 0.12 : 0.55} />
                                <stop offset="1" stopColor={T.accent} stopOpacity={0.8} />
                            </linearGradient>
                        </defs>
                        <path
                            d={`M ${anchor.x} ${anchor.y} C ${anchor.x + 160} ${anchor.y - 60}, ${linkEnd.x - 200} ${linkEnd.y}, ${linkEnd.x} ${linkEnd.y}`}
                            fill="none"
                            stroke="url(#agentLink)"
                            strokeWidth={2}
                            strokeDasharray={asleep ? "3 9" : "none"}
                            strokeDashoffset={-f * 0.6}
                        />
                    </svg>
                    <PulseDot from={linkEnd} to={anchor} t={pulse} />
                    <AgentCard x={cardPos.x} y={cardPos.y} step={step} seconds={seconds} frame={f} alpha={serverIn} />
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
