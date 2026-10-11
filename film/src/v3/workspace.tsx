import React from "react";
import { epochLine, trainHeader } from "../kit/data";
import { EditorView, FilesView } from "../kit/panels";
import { type Cam, World } from "../kit/stage";
import { CELL_H, CELL_W, T } from "../kit/tokens";
import {
    AppWindow,
    Block,
    CMDBAR_H,
    CmdBar,
    GAP,
    HEADER_H,
    TABBAR_H,
    TermHeader,
    TermText,
    WIN_H,
    WIN_W,
    md,
    prompt,
    sans,
    tileRect,
    type Line,
    type RailItem,
} from "../kit/ui";

// The GenieTerm window as every UI scene sees it. Scenes pass in what's on screen; the
// window, its shadow and the coordinates of things the camera or cursor aim at live here.

export const LocalPrompt = "you@laptop ~ % ";
export const localPromptLine = (cmd = ""): Line => [...md(`{g}you@laptop{/} {b}~{/} % `), ...(cmd ? [{ t: cmd }] : [])];

export const TERM_PAD_X = 14;
export const TERM_PAD_Y = 10;

// World position of a block's content origin (its top-left inside the 1 px frame).
export function blockOrigin(rect: { left: number; top: number }) {
    return { x: rect.left + 1, y: TABBAR_H + GAP + rect.top + 1 };
}

// The caret cell of the main terminal when it is the only block and the prompt is on `row`.
export function termCaretWorld(col: number, row = 0, rect = { left: 0, top: 0 }, top = HEADER_H + TERM_PAD_Y) {
    const o = blockOrigin(rect);
    return { x: o.x + TERM_PAD_X + col * CELL_W, y: o.y + top + row * CELL_H + 1 };
}

export const WindowShadow: React.FC<{ children: React.ReactNode; lift?: number }> = ({ children, lift = 1 }) => (
    <div
        style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: WIN_W,
            height: WIN_H,
            borderRadius: 12,
            boxShadow: `0 ${60 * lift}px ${160 * lift}px rgba(0,0,0,0.72), 0 ${18 * lift}px ${48 * lift}px rgba(0,0,0,0.42)`,
        }}
    >
        {children}
    </div>
);

export const Workspace: React.FC<{
    stage: "local";
    frame: number;
    caret: boolean;
    rail?: RailItem;
}> = ({ frame, caret, rail = "terminal" }) => {
    const rect = { left: 0, top: 0, width: WIN_W - 49, height: WIN_H - TABBAR_H - GAP - 1 };
    return (
        <WindowShadow>
            <AppWindow rail={rail}>
                <Block rect={rect} focused header={<TermHeader local host="Local terminal" cwd="~" />}>
                    <TermText lines={[localPromptLine()]} caret={caret ? (Math.floor(frame / 32) % 2 === 0 ? 1 : 0) : 0} />
                </Block>
            </AppWindow>
        </WindowShadow>
    );
};

// ---------- the training layout: terminal | files / editor ----------

export const TrainLayout = {
    split: 0.56,
    term: () => tileRect({}, 0, TrainLayout.split),
    files: () => tileRect({}, TrainLayout.split, 1, 0, 0.5),
    editor: () => tileRect({}, TrainLayout.split, 1, 0.5, 1),
};

// The run's terminal: its block bar on top, then the command and the latest epochs.
export function trainLines(epoch: number, rows = 34): Line[] {
    const first = Math.max(1, epoch - rows + 1);
    const out: Line[] = [];
    if (first === 1) {
        out.push(prompt("python train.py"), trainHeader);
    }
    for (let e = first; e <= epoch; e++) {
        out.push(epochLine(e));
    }
    return out;
}

export type LinkState = { kind: "live" } | { kind: "reconnecting" } | { kind: "reconnected"; t: number };

export const TrainingWindow: React.FC<{
    frame: number;
    epoch: number;
    seconds: number;
    link?: LinkState;
    radius?: number;
}> = ({ frame, epoch, seconds, link = { kind: "live" }, radius = 12 }) => {
    const term = TrainLayout.term();
    return (
        <AppWindow rail="terminal" style={{ borderRadius: radius }}>
            <Block rect={term} focused header={<TermHeader />}>
                <CmdBar command="python train.py" state={{ kind: "running", seconds }} frame={frame} />
                <TermText lines={trainLines(epoch)} y={HEADER_H + CMDBAR_H + 14} />
                {link.kind !== "live" && <LinkBadge link={link} />}
            </Block>
            <Block rect={TrainLayout.files()}>
                <FilesView />
            </Block>
            <Block rect={TrainLayout.editor()}>
                <EditorView lr="6e-4" caretOn={0} dirty={false} saved={0} />
            </Block>
        </AppWindow>
    );
};

// The header's connection state while the laptop finds its way back to the session.
const LinkBadge: React.FC<{ link: LinkState }> = ({ link }) => {
    const ok = link.kind === "reconnected";
    const fade = ok ? 1 - Math.max(0, Math.min(1, (link.t - 100) / 30)) : 1;
    return (
        <div
            style={{
                position: "absolute",
                left: 200,
                top: 6,
                height: 18,
                padding: "0 9px",
                borderRadius: 9,
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: ok ? "rgba(95,191,106,0.14)" : "rgba(224,185,86,0.14)",
                opacity: fade,
                ...sans(11, 500, ok ? "#7fd18a" : T.warning),
            }}
        >
            <span style={{ width: 6, height: 6, borderRadius: 3, background: ok ? "#5fbf6a" : T.warning }} />
            {ok ? "Reconnected" : "Reconnecting…"}
        </div>
    );
};

// ---------- the lifted block bar with its label ----------

// World rectangle of the training terminal's block bar.
export function barWorld(rect = TrainLayout.term()) {
    const o = blockOrigin(rect);
    return { x: o.x + 6, y: o.y + HEADER_H, w: rect.width - 12, h: CMDBAR_H, rect };
}

// Where the camera sits to read the bar: its left half large, label room below.
export const BarCam = { x: 278, y: 141, zoom: 2.8 };

export const BlockSpotlight: React.FC<{
    cam: Cam;
    amount: number;
    bar: React.ReactNode;
    rect: { left: number; top: number; width: number; height: number };
}> = ({ cam, amount, bar, rect }) => {
    if (amount <= 0) {
        return null;
    }
    const o = blockOrigin(rect);
    return (
        <World cam={cam}>
            <div
                style={{
                    position: "absolute",
                    left: o.x,
                    top: o.y,
                    width: rect.width,
                    height: HEADER_H + CMDBAR_H + 8,
                    opacity: amount,
                    transform: `scale(${1 + 0.035 * amount})`,
                    transformOrigin: `${rect.width * 0.2}px ${HEADER_H + 17}px`,
                    filter: `drop-shadow(0 ${14 * amount}px ${30 * amount}px rgba(0,0,0,0.6))`,
                }}
            >
                <div style={{ position: "absolute", left: 0, top: HEADER_H - 2, width: rect.width, height: CMDBAR_H + 4, background: "#0e0e0f", borderRadius: 9 }} />
                <div style={{ position: "absolute", left: 0, top: 0, width: rect.width, height: HEADER_H + CMDBAR_H + 8 }}>{bar}</div>
            </div>
        </World>
    );
};

// A soft dark pool behind a label so blurred UI never competes with the words.
export const Scrim: React.FC<{ x: number; y: number; w: number; h: number; amount: number }> = ({ x, y, w, h, amount }) => (
    <div
        style={{
            position: "absolute",
            left: x - w * 0.15,
            top: y - h * 0.35,
            width: w * 1.3,
            height: h * 1.7,
            background: "radial-gradient(closest-side, rgba(0,0,0,0.55), rgba(0,0,0,0))",
            opacity: amount,
        }}
    />
);
