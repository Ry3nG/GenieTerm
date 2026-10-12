import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Pointer, cursorAt } from "../lib/cursor";
import { HostView } from "../kit/host";
import { Label } from "../kit/label";
import { Ease, FPS, Spring, additive, ramp, springAt } from "../kit/motion";
import { EnginePicker, InlineSuggestion, SheetAnswer, SheetFooter, SheetFrame, SheetThinking, SheetTitleFix } from "../kit/panels";
import { Studio, World, camPath, recede, toScreen, withDrift } from "../kit/stage";
import { AppWindow, Block, CMDBAR_H, CmdBar, HEADER_H, TermHeader, TermText, md, prompt, sans, tileRect, type CmdState, type Line } from "../kit/ui";
import { WindowShadow, blockOrigin, trainLines } from "./workspace";

// Asking the AI you already use. The install fails; Fix with AI asks once which AI to use and
// lists the ones already on this computer; the answer explains, proposes, labels the risk,
// and waits. Then a plain sentence typed at the prompt becomes a command.

export const A = {
    type1: 44,
    enter1: 130,
    failed: 236,
    fix: 300,
    sheet: 306,
    pickHover: 520,
    pick: 562,
    thinking: 570,
    answer: 666,
    proposals: 744,
    label1: 800,
    insert: 980,
    enter2: 1044,
    done: 1112,
    type3: 1150,
    enter3: 1232,
    inline: 1250,
    ready: 1302,
    label2: 1318,
    end: 1440,
};

const PIP = "pip install flash-attn";
const FIX = "FLASH_ATTENTION_SKIP_CUDA_BUILD=TRUE pip install flash-attn --no-build-isolation";
const ASK = "show disk space left";
const EXPLAIN = "flash-attn tried to compile its CUDA kernels, and this machine has no `CUDA_HOME`. Install the prebuilt wheel instead of building it.";

const failOut: Line[] = [
    md("Collecting flash-attn"),
    md("  Using cached flash_attn-2.8.3.tar.gz (8.4 MB)"),
    md("  Preparing metadata (setup.py) ... {r}error{/}"),
    md("  {r}×{/} python setup.py egg_info did not run successfully."),
    md("  │ exit code: 1"),
    md("  ╰─> OSError: CUDA_HOME environment variable is not set."),
    md("{r}error: metadata-generation-failed{/}"),
];
const okOut: Line[] = [
    md("Collecting flash-attn"),
    md("  Using cached flash_attn-2.8.3-cp311-cp311-linux_x86_64.whl (187.4 MB)"),
    md("Installing collected packages: flash-attn"),
    md("{g}Successfully installed flash-attn-2.8.3{/}"),
];

const typedOf = (s: string, f: number, start: number, per = 3.6) => s.slice(0, Math.max(0, Math.min(s.length, Math.floor((f - start) / per))));
const linesOver = (ls: Line[], f: number, start: number, per = 12) => ls.slice(0, Math.max(0, Math.floor((f - start) / per) + 1));

export const Ai: React.FC = () => {
    const f = useCurrentFrame();
    const fadeIn = ramp(f, 0, 30, Ease.glide);
    const exit = ramp(f, A.end - 34, A.end - 2, Ease.glide);

    const trainRect = tileRect({}, 0, 0.56, 0, 0.34);
    const work = tileRect({}, 0, 0.56, 0.34, 1);
    const o = blockOrigin(work);
    const sheetLeft = o.x + (work.width - 720) / 2;
    const bottom = o.y + work.height - 2 - 12;

    // ---- the work terminal, phase by phase ----
    let cmd: string | null = null;
    let state: CmdState | null = null;
    let lines: Line[];
    let caret = 0;
    if (f < A.enter1) {
        lines = [prompt(typedOf(PIP, f, A.type1))];
        caret = 1;
    } else if (f < A.insert + 8) {
        cmd = PIP;
        lines = [prompt(PIP), ...linesOver(failOut, f, A.enter1 + 10, 14), ...(f >= A.failed ? [prompt("")] : [])];
        state = f < A.failed ? { kind: "running", seconds: (f - A.enter1) / FPS } : { kind: "failed", code: 1 };
        caret = f >= A.failed ? 1 : 0;
    } else if (f < A.enter2) {
        cmd = PIP;
        state = { kind: "failed", code: 1 };
        lines = [prompt(PIP), ...failOut, prompt(FIX)];
        caret = 1;
    } else if (f < A.type3) {
        cmd = FIX;
        state = f < A.done ? { kind: "running", seconds: (f - A.enter2) / FPS } : { kind: "done", label: "Finished 6.2s" };
        lines = [prompt(FIX), ...linesOver(okOut, f, A.enter2 + 8, 16), ...(f >= A.done ? [prompt("")] : [])];
        caret = f >= A.done ? 1 : 0;
    } else {
        cmd = FIX;
        state = { kind: "done", label: "Finished 6.2s" };
        const asked = f >= A.enter3 ? [prompt(ASK), md("bash: show: command not found"), prompt("")] : [prompt(typedOf(ASK, f, A.type3))];
        lines = [prompt(FIX), ...okOut, ...asked];
        caret = 1;
    }
    const blink = caret && (f % 64 < 32 || (f > A.type1 && f < A.enter1) || (f > A.type3 && f < A.enter3)) ? 1 : 0;
    const textTop = cmd ? HEADER_H + CMDBAR_H + 14 : HEADER_H + 10;
    const fixBtn = f >= A.failed ? ramp(f, A.failed + 10, A.failed + 30, Ease.out) + ramp(f, A.fix - 4, A.fix, Ease.linear) * (1 - ramp(f, A.fix, A.fix + 10, Ease.linear)) : 0;

    // ---- the sheet ----
    const sheetIn = springAt(f, A.sheet, Spring.medium);
    const sheetOut = ramp(f, A.insert + 4, A.insert + 20, Ease.exit);
    const sheetAlpha = f < A.sheet ? 0 : Math.min(1, sheetIn * 1.3) * (1 - sheetOut);
    const pickT = ramp(f, A.pick, A.pick + 16, Ease.out);
    const explainShown = Math.floor(ramp(f, A.answer, A.answer + 76, Ease.linear) * EXPLAIN.length);
    const insertPress = ramp(f, A.insert - 4, A.insert, Ease.linear) * (1 - ramp(f, A.insert, A.insert + 8, Ease.linear));
    // the sheet resizes between its states instead of snapping (heights measured at 1:1)
    const sheetH = additive(f, [
        { at: A.sheet, v: 246 },
        { at: A.thinking, v: 189 },
        { at: A.answer, v: 277 },
    ], Spring.medium);
    const switched = f < A.thinking ? A.sheet : f < A.answer ? A.thinking : A.answer;
    const next = f < A.thinking ? A.thinking : f < A.answer ? A.answer : Infinity;
    // the outgoing state fades before the switch, the incoming one after it: never a blank frame
    const bodyAlpha = ramp(f, switched + 1, switched + 12, Ease.out) * (1 - ramp(f, next - 8, next, Ease.glide));
    let sheet: React.ReactNode = null;
    if (f >= A.sheet && f < A.insert + 20) {
        if (f < A.thinking) {
            sheet = (
                <SheetFrame title={<span style={sans(12, 600)}>Command AI</span>} height={sheetH} bodyAlpha={f < A.sheet + 14 ? 1 : bodyAlpha}>
                    <EnginePicker hover={f >= A.pickHover ? "claude" : undefined} picked={f >= A.pick ? "claude" : undefined} pick={pickT} reveal={(i) => ramp(f, A.sheet + 14 + i * 5, A.sheet + 40 + i * 5, Ease.enter)} />
                </SheetFrame>
            );
        } else if (f < A.answer) {
            sheet = (
                <SheetFrame title={<SheetTitleFix command={PIP} />} footer={<SheetFooter engine="Claude Code" />} height={sheetH} bodyAlpha={bodyAlpha}>
                    <SheetThinking frame={f} label="Asking Claude Code…" />
                </SheetFrame>
            );
        } else {
            sheet = (
                <SheetFrame title={<SheetTitleFix command={PIP} />} footer={<SheetFooter engine="Claude Code" />} height={sheetH} bodyAlpha={bodyAlpha}>
                    <SheetAnswer
                        explain={EXPLAIN}
                        shown={explainShown}
                        reveal={ramp(f, A.proposals, A.proposals + 30, Ease.enter)}
                        selected={0}
                        insertPress={insertPress}
                        proposals={[{ command: FIX, note: "Skips the CUDA build and uses the wheel that matches your torch.", risk: { label: "Installs or removes software", level: "caution" } }]}
                    />
                </SheetFrame>
            );
        }
    }

    // ---- the inline suggestion ----
    const inlineIn = springAt(f, A.inline, Spring.medium);

    // ---- camera ----
    const uiCam = camPath(f, [
        { at: 0, x: 440, y: 620, zoom: 1.75 },
        { at: A.enter1, x: 420, y: 520, zoom: 2.0 },
        { at: A.sheet - 6, x: 440, y: 700, zoom: 1.85 },
        { at: A.pickHover - 70, x: 440, y: 760, zoom: 2.35 },
        { at: A.answer - 10, x: 440, y: 720, zoom: 1.95 },
        { at: A.proposals - 20, x: 435, y: 736, zoom: 2.1 },
        { at: A.insert + 10, x: 430, y: 470, zoom: 1.9 },
        { at: A.type3 - 30, x: 430, y: 560, zoom: 1.9 },
        { at: A.inline, x: 430, y: 700, zoom: 1.95 },
    ]);
    const cam = withDrift(uiCam, f, 0.8);

    const pointer = cursorAt(
        [
            { f: A.failed + 10, x: 700, y: 560 },
            { f: A.fix, x: o.x + work.width - 60, y: o.y + HEADER_H + 17, dur: 46, click: true },
            { f: A.pickHover, x: sheetLeft + 380, y: bottom - 76, dur: 60 },
            { f: A.pick, x: sheetLeft + 372, y: bottom - 78, dur: 20, click: true },
            { f: A.insert, x: sheetLeft + 58, y: bottom - 62, dur: 60, click: true },
        ],
        f,
        FPS
    );
    const pointerAlpha = ramp(f, A.failed + 10, A.failed + 30, Ease.out) * (1 - ramp(f, A.insert + 16, A.insert + 34, Ease.exit));

    // ---- label beats: lift the sheet / the suggestion over the receded window ----
    const spot1 = ramp(f, A.label1 - 24, A.label1 + 16, Ease.move) * (1 - ramp(f, A.insert - 30, A.insert - 6, Ease.move));
    const spot2 = ramp(f, A.label2 - 20, A.label2 + 16, Ease.move);
    const spot = Math.max(spot1, spot2);

    const terminal = (
        <Block rect={work} focused header={<TermHeader />}>
            {cmd && <CmdBar command={cmd} state={state!} frame={f} fix={state?.kind === "failed" ? Math.min(2, fixBtn) : 0} />}
            <TermText lines={lines} y={textTop} caret={blink} />
        </Block>
    );
    const sheetNode =
        sheet && sheetAlpha > 0 ? (
            <div
                style={{
                    position: "absolute",
                    left: sheetLeft,
                    top: bottom,
                    transform: `translateY(-100%) translateY(${(1 - sheetIn) * 30 + sheetOut * 12}px)`,
                    opacity: sheetAlpha,
                }}
            >
                {sheet}
            </div>
        ) : null;
    const inlineNode =
        f >= A.inline ? (
            <div style={{ position: "absolute", left: o.x + (work.width - 640) / 2, top: bottom, transform: `translateY(-100%) translateY(${(1 - inlineIn) * 24}px)`, opacity: Math.min(1, inlineIn * 1.4) }}>
                <InlineSuggestion state={f < A.ready ? "thinking" : "ready"} prompt={ASK} command="df -h ~" note="Shows free space on the disk that holds your home folder." />
            </div>
        ) : null;

    const ws = (
        <WindowShadow>
            <AppWindow rail="host">
                <Block rect={trainRect} header={<TermHeader />}>
                    <CmdBar command="python train.py" state={{ kind: "running", seconds: 7 * 3600 + 31 * 60 + f / FPS }} frame={f} />
                    <TermText lines={trainLines(91 + Math.floor(f / 400), 10)} y={HEADER_H + CMDBAR_H + 14} />
                </Block>
                {terminal}
                <Block rect={tileRect({}, 0.56, 1)}>
                    <HostView build={1} frame={f} width={tileRect({}, 0.56, 1).width} />
                </Block>
            </AppWindow>
        </WindowShadow>
    );

    const sheetTop = toScreen(cam, sheetLeft, bottom - 252);
    const inlineTop = toScreen(cam, o.x + (work.width - 640) / 2, bottom - 70);
    return (
        <AbsoluteFill style={{ background: "#000", opacity: fadeIn * (1 - exit) }}>
            <Studio />
            <AbsoluteFill style={recede(spot)}>
                <World cam={cam}>{ws}</World>
            </AbsoluteFill>
            <World cam={cam}>
                <div style={{ position: "absolute", left: 0, top: 0, filter: spot > 0.01 ? `drop-shadow(0 ${18 * spot}px ${40 * spot}px rgba(0,0,0,${0.6 * spot}))` : undefined }}>
                    {sheetNode}
                    {inlineNode}
                </div>
                {pointerAlpha > 0 && (
                    <div style={{ position: "absolute", left: 0, top: 0, opacity: pointerAlpha }}>
                        <Pointer x={pointer.x} y={pointer.y} press={pointer.press} size={16} />
                    </div>
                )}
            </World>
            <Label frame={f} x={sheetTop.x} y={sheetTop.y - 132} text="It suggests. You decide." sub="Insert puts it at your prompt. Nothing runs on its own." from={A.label1} to={A.insert - 10} />
            <Label frame={f} x={inlineTop.x} y={inlineTop.y - 170} text="Or just say what you want." sub="A plain sentence at the prompt becomes a command." from={A.label2} to={A.end + 30} />
        </AbsoluteFill>
    );
};

