import React from "react";
import { MonoFamily } from "../lib/fonts";
import { FilesView } from "../kit/panels";
import { T } from "../kit/tokens";
import { AppWindow, Block, CMDBAR_H, CmdBar, HEADER_H, TermHeader, TermText, md, sans, tileRect, type Line } from "../kit/ui";
import type { LinkState } from "../v3/workspace";

// A coding agent at work in a GenieTerm terminal on the server, and the file it is editing.
// The transcript follows the shape of Claude Code's own output: a prompt box, then one line
// per tool call with its result tucked underneath.

export const AgentLayout = {
    split: 0.56,
    term: () => tileRect({}, 0, AgentLayout.split),
    files: () => tileRect({}, AgentLayout.split, 1, 0, 0.36),
    code: () => tileRect({}, AgentLayout.split, 1, 0.36, 1),
};

export const REQUEST = "Switch train.py to bf16 autocast and get the tests passing";

// One row of the prompt box: "│ " + text padded to the box's inside width + "│".
const BOX_W = 66;
const box = (inner: string, caret = false) => {
    const pad = Math.max(0, BOX_W - 1 - inner.length - (caret ? 1 : 0));
    return md(`{d}│{/} {w}${inner}{/}${caret ? "{w}█{/}" : ""}${" ".repeat(pad)}{d}│{/}`);
};

// Every line the session prints, with the step at which it appears.
export type Step = { at: number; lines: Line[] };

export function agentSteps(typed: string, caret = false): Step[] {
    const top = md(`{d}╭${"─".repeat(BOX_W)}╮{/}`);
    const bottom = md(`{d}╰${"─".repeat(BOX_W)}╯{/}`);
    return [
        { at: 0, lines: [md("{g}ml@atlas{/} {b}~/llm{/} $ claude"), md(""), top, box(`> ${typed}`, caret), bottom, md("")] },
        { at: 1, lines: [md("{a}●{/} Read({w}train.py{/})")] },
        { at: 2, lines: [md("{a}●{/} Update({w}train.py{/})"), md("  {d}⎿  Wrapped the forward pass in torch.autocast(bfloat16){/}")] },
        { at: 3, lines: [md("{a}●{/} Bash({w}pytest -q{/})")] },
        { at: 4, lines: [md("  {d}⎿  {/}{r}3 failed{/}{d}, 39 passed in 17.9s{/}")] },
        { at: 5, lines: [md("{a}●{/} Update({w}tests/test_loss.py{/})"), md("  {d}⎿  Loosened the loss tolerance for bf16 (atol 1e-2){/}")] },
        { at: 6, lines: [md("{a}●{/} Bash({w}pytest -q{/})")] },
        { at: 7, lines: [md("  {d}⎿  {/}{g}42 passed{/}{d} in 18.4s{/}")] },
        { at: 8, lines: [md(""), md("{g}✓{/} {w}Done.{/} train.py now trains under bf16 autocast, and all 42 tests pass.")] },
    ];
}

export function agentLines(typed: string, step: number, caret = false): Line[] {
    return agentSteps(typed, caret)
        .filter((s) => s.at <= step)
        .flatMap((s) => s.lines);
}

// The tool call that is still running gets the spinner the session shows while it works.
export function runningLine(step: number, frame: number): Line | null {
    const running = step === 3 || step === 6 ? "Running…" : null;
    if (!running) {
        return null;
    }
    const dots = ["·", "✢", "✳", "✶", "✻", "✽"][Math.floor(frame / 8) % 6];
    return md(`  {a}${dots}{/} {d}${running}{/}`);
}

const Py = { kw: "#c586c0", fn: "#dcdcaa", str: "#ce9178", num: "#b5cea8", com: "#6a9955", id: "#d4d4d4" };

type CodeLine = { t: React.ReactNode; added?: boolean };

const k = (s: string) => <span style={{ color: Py.kw }}>{s}</span>;
const s_ = (s: string) => <span style={{ color: Py.str }}>{s}</span>;
const fn = (s: string) => <span style={{ color: Py.fn }}>{s}</span>;

function trainPy(edited: boolean): CodeLine[] {
    const body: CodeLine[] = edited
        ? [
              { t: <>            {k("with")} torch.{fn("autocast")}({s_('"cuda"')}, dtype=torch.bfloat16):</>, added: true },
              { t: <>                logits = {fn("model")}(x)</>, added: true },
              { t: <>                loss = F.{fn("cross_entropy")}(logits.{fn("flatten")}(0, 1), y.{fn("flatten")}())</>, added: true },
          ]
        : [{ t: <>            logits = {fn("model")}(x)</> }, { t: <>            loss = F.{fn("cross_entropy")}(logits.{fn("flatten")}(0, 1), y.{fn("flatten")}())</> }];
    return [
        { t: <>{k("def")} {fn("train")}(model, loader, opt, epochs):</> },
        { t: <>    {k("for")} epoch {k("in")} {fn("range")}(epochs):</> },
        { t: <>        {k("for")} x, y {k("in")} loader:</> },
        { t: <>            x, y = x.{fn("to")}(dev), y.{fn("to")}(dev)</> },
        ...body,
        { t: <>            opt.{fn("zero_grad")}(set_to_none={k("True")})</> },
        { t: <>            loss.{fn("backward")}()</> },
        { t: <>            opt.{fn("step")}()</> },
        { t: <>    {k("return")} loss.{fn("item")}()</> },
    ];
}

export const CodeView: React.FC<{ edited: boolean; flash: number }> = ({ edited, flash }) => {
    const lines = trainPy(edited);
    return (
        <div style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", left: 12, top: 0, height: 30, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={sans(12.5, 500)}>atlas</span>
                <span style={{ fontFamily: MonoFamily, fontSize: 12, color: T.secondary }}>~/llm/train.py</span>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 40 }}>
                {lines.map((l, i) => (
                    <div
                        key={i}
                        style={{
                            position: "relative",
                            height: 19,
                            background: l.added ? `rgba(95,191,106,${0.1 + 0.18 * flash})` : "transparent",
                            boxShadow: l.added ? "inset 2px 0 0 #5fbf6a" : "none",
                        }}
                    >
                        <span style={{ position: "absolute", left: 0, width: 36, textAlign: "right", fontFamily: MonoFamily, fontSize: 12, color: "#5a5a5e", lineHeight: "19px" }}>{40 + i}</span>
                        <span style={{ position: "absolute", left: 52, fontFamily: MonoFamily, fontSize: 13, color: Py.id, lineHeight: "19px", whiteSpace: "pre" }}>{l.t}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export const AgentWindow: React.FC<{
    frame: number;
    typed: string;
    step: number;
    seconds: number;
    edited: boolean;
    flash?: number;
    link?: LinkState;
    radius?: number;
    caret?: number;
}> = ({ frame, typed, step, seconds, edited, flash = 0, link = { kind: "live" }, radius = 12, caret = 0 }) => {
    const term = AgentLayout.term();
    const running = runningLine(step, frame);
    const lines = [...agentLines(typed, step, caret > 0), ...(running ? [running] : [])];
    return (
        <AppWindow rail="terminal" style={{ borderRadius: radius }}>
            <Block rect={term} focused header={<TermHeader />}>
                <CmdBar command="claude" state={{ kind: "running", seconds }} frame={frame} />
                <TermText lines={lines} y={HEADER_H + CMDBAR_H + 14} />
                {link.kind !== "live" && <LinkPill link={link} />}
            </Block>
            <Block rect={AgentLayout.files()}>
                <FilesView selected="train.py" select={0.6} />
            </Block>
            <Block rect={AgentLayout.code()}>
                <CodeView edited={edited} flash={flash} />
            </Block>
        </AppWindow>
    );
};

const LinkPill: React.FC<{ link: LinkState }> = ({ link }) => {
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
