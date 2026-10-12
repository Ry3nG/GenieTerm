import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { SansFamily } from "../lib/fonts";
import { EndCard } from "../lib/endcard";
import { HostView } from "../kit/host";
import { Ease, FPS, mix, ramp } from "../kit/motion";
import { Studio, World } from "../kit/stage";
import { T } from "../kit/tokens";
import { AppWindow, Block, CMDBAR_H, CmdBar, HEADER_H, TermHeader, TermText, WIN_H, WIN_W, prompt, tileRect } from "../kit/ui";
import { WindowShadow, trainLines } from "./workspace";

// The breath at the end: the whole workspace, still working, turning slowly in the dark, with
// everything the film showed named once in a quiet line. Then the name.

const RECAP = ["Command blocks", "Remote files", "Durable sessions", "Host", "Port forwarding", "Command AI"];

export const OUTRO_CARD = 380;

export const Outro: React.FC = () => {
    const f = useCurrentFrame();
    const t = ramp(f, 0, OUTRO_CARD, Ease.linear);
    const cam = {
        x: WIN_W / 2,
        y: WIN_H / 2 + 30,
        zoom: mix(0.8, 0.7, Ease.move(t)),
        rx: mix(4, 13, Ease.move(t)),
        ry: mix(-4, -17, Ease.move(t)),
        rz: mix(0.5, 1.8, Ease.move(t)),
    };
    const fadeIn = ramp(f, 0, 30, Ease.out);
    const out = ramp(f, OUTRO_CARD - 50, OUTRO_CARD, Ease.exit);
    const seconds = 7 * 3600 + 40 * 60 + f / FPS;
    const train = tileRect({}, 0, 0.56, 0, 0.5);
    const work = tileRect({}, 0, 0.56, 0.5, 1);
    const right = tileRect({}, 0.56, 1);
    return (
        <AbsoluteFill style={{ background: "#000" }}>
            <AbsoluteFill style={{ opacity: fadeIn * (1 - out), filter: `blur(${out * 10}px)` }}>
                <Studio />
                <World cam={cam} perspective={2200}>
                    <WindowShadow lift={1.4}>
                        <AppWindow rail="host">
                            <Block rect={train} header={<TermHeader />}>
                                <CmdBar command="python train.py" state={{ kind: "running", seconds }} frame={f} />
                                <TermText lines={trainLines(95 + Math.floor(f / 160), 22)} y={HEADER_H + CMDBAR_H + 14} />
                            </Block>
                            <Block rect={work} focused header={<TermHeader />}>
                                <CmdBar command="FLASH_ATTENTION_SKIP_CUDA_BUILD=TRUE pip install flash-attn --no-build-isolation" state={{ kind: "done", label: "Finished 6.2s" }} frame={f} />
                                <TermText lines={[prompt("df -h ~")]} y={HEADER_H + CMDBAR_H + 14} caret={Math.floor(f / 32) % 2 === 0 ? 1 : 0} />
                            </Block>
                            <Block rect={right}>
                                <HostView build={1} frame={f} width={right.width} />
                            </Block>
                        </AppWindow>
                    </WindowShadow>
                </World>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 96, display: "flex", justifyContent: "center", gap: 34 }}>
                    {RECAP.map((r, i) => {
                        const a = ramp(f, 70 + i * 9, 110 + i * 9, Ease.enter);
                        return (
                            <span
                                key={r}
                                style={{
                                    fontFamily: SansFamily,
                                    fontSize: 25,
                                    fontWeight: 500,
                                    letterSpacing: "-0.005em",
                                    color: T.secondary,
                                    opacity: a,
                                    transform: `translateY(${(1 - a) * 10}px)`,
                                    filter: `blur(${(1 - a) * 4}px)`,
                                }}
                            >
                                {r}
                            </span>
                        );
                    })}
                </div>
            </AbsoluteFill>
            <Sequence from={OUTRO_CARD - 20}>
                <EndCard start={0} tagline="The remote-native terminal." />
            </Sequence>
        </AbsoluteFill>
    );
};
