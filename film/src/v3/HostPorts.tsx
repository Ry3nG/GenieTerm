import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Pointer, cursorAt } from "../lib/cursor";
import { HostView } from "../kit/host";
import { Label } from "../kit/label";
import { Ease, FPS, Spring, mix, ramp, springAt } from "../kit/motion";
import { BrowserWindow, EditorView, FilesView, ForwardDock } from "../kit/panels";
import { Studio, World, camPath, recede, toScreen, withDrift } from "../kit/stage";
import { TensorBoardPage } from "../kit/tensorboard";
import { AppWindow, Block, CMDBAR_H, CmdBar, HEADER_H, TermHeader, TermText, md, prompt, tileRect, type Line } from "../kit/ui";
import { WindowShadow, blockOrigin, trainLines } from "./workspace";

// The whole machine: Host opens beside the run, GPU, processes and ports in one place. Then
// TensorBoard starts on the server, GenieTerm offers its port, and one click opens it here.

export const H = {
    rail: 60,
    swap: 66,
    build: [120, 280] as const,
    procs: 300,
    ports: 380,
    split: 440,
    type: 480,
    enter: 566,
    dock: 620,
    click: 694,
    forwarded: 722,
    fly: 728,
    draw: [770, 900] as const,
    label: 800,
    end: 960,
};

const TB = "tensorboard --logdir runs";
const EPOCH = 88;
const RUN_S = 7 * 3600 + 22 * 60;

export const HostPorts: React.FC = () => {
    const f = useCurrentFrame();
    const fadeIn = ramp(f, 0, 30, Ease.glide);
    const seconds = RUN_S + f / FPS;
    const epoch = EPOCH + Math.floor(f / 300);

    const swap = springAt(f, H.swap, Spring.large);
    const hostIn = ramp(f, H.swap, H.swap + 34, Ease.enter);
    const leftSplit = mix(1, 0.52, springAt(f, H.split, Spring.large));
    const tbIn = ramp(f, H.split + 4, H.split + 36, Ease.enter);

    const right = tileRect({}, 0.56, 1);
    const trainRect = tileRect({}, 0, 0.56, 0, leftSplit);
    const tbRect = tileRect({}, 0, 0.56, leftSplit, 1);
    const tbFinal = tileRect({}, 0, 0.56, 0.52, 1);
    const tbO = blockOrigin(tbFinal);

    const typed = Math.max(0, Math.min(TB.length, Math.floor((f - H.type) / 3.3)));
    const running = f >= H.enter;
    const tbLines: Line[] = !running
        ? [prompt(TB.slice(0, typed))]
        : [
              prompt(TB),
              ...[
                  md("{d}TensorFlow installation not found - running with reduced feature set.{/}"),
                  md(""),
                  md("Serving TensorBoard on localhost; to expose to the network, use a proxy"),
                  md("TensorBoard 2.20.0 at {a}http://localhost:6006/{/} (Press CTRL+C to quit)"),
              ].slice(0, Math.max(0, Math.floor((f - H.enter - 6) / 7))),
          ];
    const tbCaret = !running && f > H.split + 20 ? 1 : 0;
    const tbBlock = springAt(f, H.enter, Spring.medium);

    const dockIn = springAt(f, H.dock, Spring.medium);
    const status = f < H.click + 4 ? "offer" : f < H.forwarded ? "busy" : "forwarded";
    const press = ramp(f, H.click, H.click + 5, Ease.linear) * (1 - ramp(f, H.click + 5, H.click + 14, Ease.linear));

    const uiCam = camPath(f, [
        { at: 0, x: 800, y: 450, zoom: 0.95 },
        { at: 96, x: 1205, y: 290, zoom: 1.6 },
        { at: 270, x: 1205, y: 560, zoom: 1.75 },
        { at: 420, x: 440, y: 640, zoom: 1.45 },
        { at: 600, x: 440, y: 790, zoom: 2.05 },
        { at: H.fly, x: 520, y: 640, zoom: 1.3 },
    ]);
    const cam = withDrift(uiCam, f, 0.8);

    const dockW = { x: tbO.x + tbFinal.width / 2, y: tbO.y + tbFinal.height - 12 - 23 };
    const pointer = cursorAt(
        [
            { f: 20, x: 980, y: 420 },
            { f: H.rail, x: 1576, y: 181, dur: 40, click: true },
            { f: H.dock - 10, x: 760, y: 760, dur: 30 },
            { f: H.click, x: dockW.x + 120, y: dockW.y + 1, dur: 50, click: true },
        ],
        f,
        FPS
    );
    const pointerAlpha = ramp(f, 20, 36, Ease.out) * (1 - ramp(f, H.rail + 20, H.rail + 40, Ease.exit)) + ramp(f, H.dock + 10, H.dock + 30, Ease.out) * (1 - ramp(f, H.forwarded, H.forwarded + 20, Ease.exit));

    // the dashboard comes forward out of the dock, the app recedes behind it
    const fly = springAt(f, H.fly, Spring.large);
    const dockScreen = toScreen(cam, dockW.x - 160, dockW.y);
    const final = { x: 130, y: 170, w: 1080, h: 740 };
    const rect = {
        x: mix(dockScreen.x, final.x, fly),
        y: mix(dockScreen.y, final.y, fly),
        w: mix(200, final.w, fly),
        h: mix(30, final.h, fly),
    };
    const browserAlpha = ramp(f, H.fly, H.fly + 14, Ease.out);
    const back = ramp(f, H.fly, H.fly + 50, Ease.move) * (1 - ramp(f, H.end - 30, H.end, Ease.exit) * 0);
    const draw = ramp(f, H.draw[0], H.draw[1], Ease.move);
    const exit = ramp(f, H.end - 34, H.end - 2, Ease.glide);

    const ws = (
        <WindowShadow>
            <AppWindow rail={f >= H.rail ? "host" : "terminal"} railPressed="host" railPress={ramp(f, H.rail, H.rail + 5, Ease.linear) * (1 - ramp(f, H.rail + 5, H.rail + 14, Ease.linear))}>
                <Block rect={trainRect} focus={f < H.split ? 1 : 0} header={<TermHeader />}>
                    <CmdBar command="python train.py" state={{ kind: "running", seconds }} frame={f} />
                    <TermText lines={trainLines(epoch)} y={HEADER_H + CMDBAR_H + 14} />
                </Block>
                {tbIn > 0 && (
                    <Block rect={tbRect} focus={f >= H.split ? 1 : 0} header={<TermHeader />} style={{ opacity: tbIn }}>
                        {running && (
                            <div style={{ opacity: ramp(f, H.enter, H.enter + 14, Ease.out), transform: `translateY(${(1 - tbBlock) * -8}px)` }}>
                                <CmdBar command={TB} state={{ kind: "running", seconds: (f - H.enter) / FPS }} frame={f} />
                            </div>
                        )}
                        <TermText lines={tbLines} y={running ? mix(HEADER_H + 10, HEADER_H + CMDBAR_H + 14, tbBlock) : HEADER_H + 10} caret={tbCaret} />
                        {dockIn > 0.001 && (
                            <div
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    bottom: 12,
                                    display: "flex",
                                    justifyContent: "center",
                                    opacity: Math.min(1, dockIn * 1.4),
                                    transform: `translateY(${(1 - dockIn) * 24}px)`,
                                }}
                            >
                                <ForwardDock status={status} press={press} />
                            </div>
                        )}
                    </Block>
                )}
                {swap < 0.999 && (
                    <div style={{ opacity: 1 - hostIn, transform: `translateY(${hostIn * 24}px)` }}>
                        <Block rect={tileRect({}, 0.56, 1, 0, 0.5)}>
                            <FilesView />
                        </Block>
                        <Block rect={tileRect({}, 0.56, 1, 0.5, 1)}>
                            <EditorView lr="6e-4" caretOn={0} dirty={false} saved={0} />
                        </Block>
                    </div>
                )}
                {hostIn > 0 && (
                    <Block rect={right} style={{ opacity: hostIn, transform: `translateY(${(1 - hostIn) * -18}px)` }}>
                        <HostView
                            build={ramp(f, H.build[0], H.build[1], Ease.linear)}
                            frame={f}
                            width={right.width}
                            rowGlow={ramp(f, H.procs, H.procs + 30, Ease.out) * (1 - ramp(f, H.ports + 20, H.ports + 50, Ease.out))}
                            portGlow={ramp(f, H.ports, H.ports + 30, Ease.out)}
                        />
                    </Block>
                )}
            </AppWindow>
            {pointerAlpha > 0 && (
                <div style={{ position: "absolute", left: 0, top: 0, opacity: pointerAlpha }}>
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} size={16} />
                </div>
            )}
        </WindowShadow>
    );

    return (
        <AbsoluteFill style={{ background: "#000", opacity: fadeIn * (1 - exit) }}>
            <Studio />
            <AbsoluteFill style={recede(back * 1.1)}>
                <World cam={cam}>{ws}</World>
            </AbsoluteFill>
            {browserAlpha > 0 && (
                <div
                    style={{
                        position: "absolute",
                        left: rect.x,
                        top: rect.y,
                        width: final.w,
                        height: final.h,
                        transformOrigin: "0 0",
                        transform: `scale(${rect.w / final.w}, ${rect.h / final.h})`,
                        opacity: browserAlpha,
                    }}
                >
                    <BrowserWindow width={final.w} height={final.h}>
                        <TensorBoardPage width={final.w} height={final.h - 40} upTo={epoch} draw={draw} />
                    </BrowserWindow>
                </div>
            )}
            <Label frame={f} x={final.x + final.w + 72} y={460} text="One click." sub="localhost:6006, on your computer." from={H.label} to={H.end} size={56} />
        </AbsoluteFill>
    );
};
