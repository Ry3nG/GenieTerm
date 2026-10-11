import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { cursorAt, Pointer } from "../lib/cursor";
import { epochLine, trainHeader } from "../kit/data";
import { Label } from "../kit/label";
import { Ease, FPS, Spring, mix, ramp, springAt } from "../kit/motion";
import { ConnPicker, EditorView, FilesView } from "../kit/panels";
import { Studio, World, camPath, recede, toScreen, withDrift } from "../kit/stage";
import {
    AppWindow,
    Block,
    CMDBAR_H,
    CmdBar,
    HEADER_H,
    Host,
    TermHeader,
    TermText,
    WIN_W,
    md,
    prompt,
    tileRect,
    type Line,
} from "../kit/ui";
import { WindowRise } from "./Title";
import { WindowShadow, blockOrigin, localPromptLine } from "./workspace";

// Getting there: pick the server from the connection list, open its files beside the
// terminal, change one value in the config, and start the run. Each command lands in its
// own block; that is the one thing this chapter names.

export const C = {
    cursorIn: 24,
    chip: 84,
    pickerOpen: 92,
    atlas: 168,
    connected: 196,
    banner: 214,
    rail: 300,
    split: 306,
    row: 400,
    editor: 410,
    lr: 478,
    typeLr: 500,
    save: 560,
    termFocus: 600,
    type: 626,
    enter: 712,
    label: 772,
    end: 960,
};

const CMD = "python train.py";
const typedAt = (f: number) => Math.max(0, Math.min(CMD.length, Math.floor((f - C.type) / 5.2)));

export function connectCam(f: number) {
    return camPath(f, [
        { at: 0, ...WindowRise.to },
        { at: 52, x: 250, y: 190, zoom: 2.15 },
        { at: 196, x: 430, y: 210, zoom: 1.6 },
        { at: 262, x: 800, y: 450, zoom: 0.95 },
        { at: 336, x: 1180, y: 270, zoom: 1.62 },
        { at: 424, x: 1180, y: 610, zoom: 1.72 },
        { at: 578, x: 440, y: 230, zoom: 1.7 },
        { at: 736, x: 278, y: 141, zoom: 2.8 },
    ]);
}

export const Connect: React.FC = () => {
    const f = useCurrentFrame();
    // drift eases in so the first frame matches the title's last exactly
    const cam = withDrift(connectCam(f), f, 0.8 * ramp(f, 0, 90, Ease.move));

    // layout: the terminal gives up the right side to Files, then Files shares it with the editor
    const split = mix(1, 0.56, springAt(f, C.split, Spring.large));
    const editorSplit = mix(1, 0.5, springAt(f, C.editor, Spring.large));
    const termRect = tileRect({}, 0, split);
    const filesRect = tileRect({}, split, 1, 0, editorSplit);
    const editorRect = tileRect({}, split, 1, editorSplit, 1);
    const filesIn = ramp(f, C.split + 4, C.split + 40, Ease.enter);
    const editorIn = ramp(f, C.editor + 4, C.editor + 40, Ease.enter);

    const connected = f >= C.connected;
    const focus = f < C.rail ? "term" : f < C.editor ? "files" : f < C.termFocus ? "editor" : "term";

    // terminal content
    const running = f >= C.enter;
    const banner: Line[] = [md(`{d}Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-49-generic x86_64){/}`), md("")];
    let lines: Line[];
    let caretRow = 0;
    if (!connected) {
        lines = [localPromptLine()];
    } else if (!running) {
        const shown = ramp(f, C.banner, C.banner + 16, Ease.linear);
        lines = shown < 1 ? [] : [...banner, prompt(CMD.slice(0, typedAt(f)))];
        caretRow = 2;
    } else {
        const epochs = Math.max(0, Math.floor((f - C.enter - 30) / 22));
        lines = [prompt(CMD), trainHeader, ...Array.from({ length: epochs }, (_, i) => epochLine(i + 1))];
    }
    const blockIn = springAt(f, C.enter, Spring.medium);
    const textTop = running ? mix(HEADER_H + 10 + 2 * 15, HEADER_H + CMDBAR_H + 14, blockIn) : HEADER_H + 10;
    const caretOn = running ? 0 : f >= C.type - 20 && f < C.enter ? 1 : Math.floor(f / 32) % 2 === 0 ? 1 : 0;

    // pointer, in world space so it scales with the UI as a real one would
    const termO = blockOrigin(termRect);
    const filesO = blockOrigin(tileRect({}, 0.56, 1, 0, 1));
    const editorO = blockOrigin(tileRect({}, 0.56, 1, 0.5, 1));
    const pointer = cursorAt(
        [
            { f: C.cursorIn, x: 520, y: 360 },
            { f: C.chip, x: 70, y: 52, dur: 50, click: true },
            { f: C.atlas - 34, x: 66, y: 132, dur: 32 },
            { f: C.atlas, x: 62, y: 197, dur: 26, click: true },
            { f: C.rail, x: 1576, y: 124, dur: 60, click: true },
            { f: C.row, x: filesO.x + 90, y: filesO.y + 60 + 3 * 26 + 13, dur: 56, click: true },
            { f: C.lr + 6, x: editorO.x + 106, y: editorO.y + 34 + 6 + 7 * 19 + 10, dur: 44, click: true },
            { f: C.save, x: editorO.x + filesO.x * 0 + (tileRect({}, 0.56, 1).width - 34), y: editorO.y + 15, dur: 44, click: true },
        ],
        f,
        FPS
    );
    const pointerAlpha = ramp(f, C.cursorIn, C.cursorIn + 20, Ease.out) * (1 - ramp(f, C.save + 20, C.save + 40, Ease.exit));

    // the config edit: double-click selects the value, then the new one is typed over it
    const lrSelected = f >= C.lr + 4 && f < C.typeLr;
    const lrValue = f < C.typeLr ? "3e-4" : "6e-4".slice(0, Math.max(1, Math.min(4, Math.floor((f - C.typeLr) / 6) + 1)));
    const dirty = f >= C.typeLr && f < C.save + 2;

    // the label beat: everything recedes but the new block's bar
    const spot = ramp(f, C.label - 20, C.label + 20, Ease.move) * (1 - ramp(f, C.end - 30, C.end, Ease.exit));
    const bar = (
        <CmdBar
            command={CMD}
            state={{ kind: "running", seconds: Math.max(0.1, (f - C.enter) / FPS) }}
            frame={f}
        />
    );
    const barAlpha = ramp(f, C.enter, C.enter + 16, Ease.out);

    const picker = ramp(f, C.pickerOpen, C.pickerOpen + 18, Ease.enter) * (1 - ramp(f, C.atlas + 6, C.atlas + 22, Ease.exit));
    const pickerSel = f < C.atlas - 12 ? 0 : 1;

    const terminal = (
        <Block rect={termRect} focus={focus === "term" ? 1 : 0} header={connected ? <TermHeader /> : <TermHeader local host="Local terminal" cwd="~" />}>
            {running && <div style={{ opacity: barAlpha, transform: `translateY(${(1 - blockIn) * -8}px)` }}>{bar}</div>}
            <TermText lines={lines} y={textTop} caret={caretOn} lineOpacity={(i) => (running && i === 0 ? 1 : 1)} />
            {connected && !running && f < C.banner + 30 && (
                <div style={{ position: "absolute", left: 14, top: HEADER_H + 10, fontSize: 12, opacity: 1 - ramp(f, C.banner, C.banner + 16, Ease.linear) }}>
                    <span style={{ color: "#8e8e93", fontFamily: "GenieSans" }}>Connecting to {Host.name}…</span>
                </div>
            )}
        </Block>
    );

    const ws = (
        <WindowShadow>
            <AppWindow rail={f >= C.rail ? "files" : "terminal"} railPressed="files" railPress={ramp(f, C.rail, C.rail + 5, Ease.linear) * (1 - ramp(f, C.rail + 5, C.rail + 14, Ease.linear))}>
                {terminal}
                {filesIn > 0 && (
                    <Block rect={filesRect} focus={focus === "files" ? 1 : 0} style={{ opacity: filesIn }}>
                        <FilesView selected={f >= C.row ? "config.yaml" : undefined} />
                    </Block>
                )}
                {editorIn > 0 && (
                    <Block rect={editorRect} focus={focus === "editor" ? 1 : 0} style={{ opacity: editorIn }}>
                        <EditorView lr={lrValue} caretOn={f >= C.typeLr && f < C.save ? 1 : 0} dirty={dirty} saved={f >= C.save + 2 ? 1 : 0} />
                        {lrSelected && <div style={{ position: "absolute", left: 52 + 6 * 7.8, top: 34 + 6 + 7 * 19 + 2, width: 4 * 7.8, height: 16, background: "rgba(41,151,255,0.38)", borderRadius: 2 }} />}
                    </Block>
                )}
            </AppWindow>
            {picker > 0 && (
                <div style={{ position: "absolute", left: 8, top: 36 + 1 + HEADER_H, opacity: picker, transform: `translateY(${(1 - picker) * -6}px) scale(${0.98 + 0.02 * picker})`, transformOrigin: "20px 0" }}>
                    <ConnPicker typed="" selected={pickerSel} caret={0} />
                </div>
            )}
            {pointerAlpha > 0 && (
                <div style={{ position: "absolute", left: 0, top: 0, opacity: pointerAlpha }}>
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} size={16} />
                </div>
            )}
        </WindowShadow>
    );

    // the lifted bar and its label, drawn over the receded window
    const barWorld = { x: termO.x + 6, y: termO.y + HEADER_H, w: termRect.width - 14 };
    const barScreen = toScreen(cam, barWorld.x, barWorld.y);
    const exit = ramp(f, C.end - 34, C.end - 2, Ease.glide);
    return (
        <AbsoluteFill style={{ background: "#000", opacity: 1 - exit, transform: `scale(${1 - exit * 0.025})`, filter: `blur(${exit * 6}px)` }}>
            <Studio />
            <AbsoluteFill style={recede(spot)}>
                <World cam={cam}>{ws}</World>
            </AbsoluteFill>
            {spot > 0 && (
                <>
                    <World cam={cam}>
                        <div
                            style={{
                                position: "absolute",
                                left: barWorld.x - 6,
                                top: barWorld.y - HEADER_H,
                                width: termRect.width,
                                height: HEADER_H + CMDBAR_H + 8,
                                opacity: spot,
                                transform: `scale(${1 + 0.035 * spot})`,
                                transformOrigin: `${termRect.width * 0.2}px ${HEADER_H + 17}px`,
                                filter: `drop-shadow(0 ${14 * spot}px ${30 * spot}px rgba(0,0,0,0.6))`,
                            }}
                        >
                            <div style={{ position: "absolute", left: 0, top: HEADER_H - 2, width: termRect.width, height: CMDBAR_H + 4, background: "#0e0e0f", borderRadius: 9 }} />
                            <div style={{ position: "absolute", left: 0, top: 0, width: termRect.width, height: HEADER_H + CMDBAR_H + 8 }}>{bar}</div>
                        </div>
                    </World>
                    <Label frame={f} x={barScreen.x + 4} y={barScreen.y + CMDBAR_H * cam.zoom + 44} text="Every command in its own block." sub="Status, time and output, together." from={C.label} to={C.end - 6} />
                </>
            )}
        </AbsoluteFill>
    );
};

export const CONNECT_W = WIN_W;
