import React from "react";
import { MonoFamily, SansFamily } from "../lib/fonts";
import { CELL_H, CELL_W, MONO_SIZE, T } from "./tokens";
import {
    IconArrows,
    IconCircleCheck,
    IconCircleX,
    IconCopy,
    IconExpand,
    IconFolder,
    IconGear,
    IconPlus,
    IconServer,
    IconShield,
    IconSparkle,
    IconSpinner,
    IconTerminal,
    IconX,
} from "./icons";

// GenieTerm's interface rebuilt in vector at the app's own CSS-pixel geometry (measured from
// the running app over CDP), so the camera can go anywhere and every pixel stays sharp.

export const WIN_W = 1600;
export const WIN_H = 900;
export const TABBAR_H = 33;
export const RAIL_W = 48;
export const GAP = 3;

// The film's machine. A fictional host so nothing real appears on screen.
export const Host = { name: "atlas", user: "ml", cwd: "~/llm", home: "/home/ml/llm" };

export const sans = (size: number, weight = 400, color: string = T.fg): React.CSSProperties => ({
    fontFamily: SansFamily,
    fontSize: size,
    fontWeight: weight,
    color,
    letterSpacing: size >= 20 ? "-0.015em" : "-0.003em",
    lineHeight: 1.25,
    whiteSpace: "nowrap",
});

export const mono = (size = MONO_SIZE, color: string = T.termFg): React.CSSProperties => ({
    fontFamily: MonoFamily,
    fontSize: size,
    color,
    whiteSpace: "pre",
    lineHeight: `${CELL_H}px`,
});

// ---------- window chrome ----------

const TrafficLights: React.FC = () => (
    <div style={{ position: "absolute", left: 14, top: 11, display: "flex", gap: 8 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }} />
        ))}
    </div>
);

export const TabBar: React.FC<{ tab?: string }> = ({ tab = "llm" }) => (
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: TABBAR_H, background: "rgba(0,0,0,0.35)" }}>
        <TrafficLights />
        <div
            style={{
                position: "absolute",
                left: 80,
                top: 7,
                width: 41,
                height: 22,
                borderRadius: 6,
                background: "rgba(245,245,247,0.1)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
            }}
        >
            <svg width={13} height={13} viewBox="0 0 12 12" style={{ position: "absolute", left: 14, top: 4.5 }}>
                {[0, 1].map((r) => [0, 1].map((c) => <circle key={`${r}${c}`} cx={3 + c * 6} cy={3 + r * 6} r={2.2} fill="#f5f5f7" />))}
            </svg>
        </div>
        <div style={{ position: "absolute", left: 130, top: 5, width: 124, height: 24, borderRadius: 8, background: "rgba(245,245,247,0.1)" }}>
            <div style={{ ...sans(11, 600, "#fff"), position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{tab}</div>
        </div>
        <IconPlus size={12} color="rgba(255,255,255,0.7)" style={{ position: "absolute", left: 268, top: 11 }} />
    </div>
);

export type RailItem = "terminal" | "files" | "host" | "settings";

export const Rail: React.FC<{ active?: RailItem; pressed?: RailItem; press?: number }> = ({ active, pressed, press = 0 }) => {
    const item = (id: RailItem, Icon: React.FC<{ size?: number; color?: string }>, y: number) => {
        const hot = id === active;
        const p = id === pressed ? press : 0;
        return (
            <div
                key={id}
                style={{
                    position: "absolute",
                    left: 2,
                    top: y,
                    width: 44,
                    height: 54,
                    borderRadius: 6,
                    background: `rgba(255,255,255,${hot ? 0.08 : 0.08 * p})`,
                    transform: `scale(${1 - 0.06 * p})`,
                }}
            >
                <div style={{ position: "absolute", left: 13, top: 8 }}>
                    <Icon size={18} color={hot ? T.fg : "#c7c7cc"} />
                </div>
                <div style={{ ...sans(10, 400, hot ? T.fg : "#c7c7cc"), position: "absolute", left: 0, right: 0, top: 33, textAlign: "center" }}>{id}</div>
            </div>
        );
    };
    return (
        <div style={{ position: "absolute", right: 0, top: TABBAR_H, width: RAIL_W, bottom: 0 }}>
            {item("terminal", IconTerminal, 6)}
            {item("files", IconFolder, 63)}
            {item("host", IconServer, 120)}
            <div style={{ position: "absolute", bottom: 10 }}>{item("settings", IconGear, -54)}</div>
        </div>
    );
};

export const AppWindow: React.FC<{
    width?: number;
    height?: number;
    tab?: string;
    rail?: RailItem;
    railPressed?: RailItem;
    railPress?: number;
    children?: React.ReactNode;
    style?: React.CSSProperties;
}> = ({ width = WIN_W, height = WIN_H, tab, rail, railPressed, railPress, children, style }) => (
    <div
        style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            borderRadius: 12,
            background: T.bg,
            overflow: "hidden",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.1)",
            ...style,
        }}
    >
        <TabBar tab={tab} />
        <Rail active={rail} pressed={railPressed} press={railPress} />
        <div style={{ position: "absolute", left: 0, top: TABBAR_H + GAP, right: RAIL_W + 1, bottom: 1 }}>{children}</div>
    </div>
);

// Lays tiles out the way the app's tile layout does: 3 px gutters, blocks fill their cells.
export function tileRect(win: { w?: number; h?: number }, x0: number, x1: number, y0 = 0, y1 = 1) {
    const w = (win.w ?? WIN_W) - RAIL_W - 1;
    const h = (win.h ?? WIN_H) - TABBAR_H - GAP - 1;
    return { left: x0 * w + (x0 > 0 ? 1 : 0), top: y0 * h + (y0 > 0 ? 1 : 0), width: (x1 - x0) * w - (x0 > 0 ? 1 : 0), height: (y1 - y0) * h - (y0 > 0 ? 1 : 0) };
}

// ---------- blocks ----------

export const Block: React.FC<{
    rect: { left: number; top: number; width: number; height: number };
    focused?: boolean;
    focus?: number;
    header?: React.ReactNode;
    children?: React.ReactNode;
    style?: React.CSSProperties;
}> = ({ rect, focused, focus, header, children, style }) => {
    const f = focus ?? (focused ? 1 : 0);
    return (
        <div style={{ position: "absolute", ...rect, borderRadius: 11, ...style }}>
            <div style={{ position: "absolute", inset: 1, borderRadius: 11, background: "rgba(0,0,0,0.5)", overflow: "hidden" }}>
                {header}
                {children}
            </div>
            <div style={{ position: "absolute", inset: 0, borderRadius: 11, boxShadow: `inset 0 0 0 2px rgba(41,151,255,${f})`, pointerEvents: "none" }} />
        </div>
    );
};

export const HEADER_H = 30;

const HeaderIcons: React.FC<{ sparkle?: number }> = ({ sparkle = 0 }) => (
    <div style={{ position: "absolute", right: 10, top: 8, display: "flex", gap: 14, alignItems: "center", color: T.muted }}>
        <IconSparkle size={13} color={sparkle > 0 ? `rgba(41,151,255,${0.6 + 0.4 * sparkle})` : T.muted} />
        <IconGear size={13} />
        <IconExpand size={12} />
        <IconX size={12} />
    </div>
);

export const TermHeader: React.FC<{ host?: string; cwd?: string; local?: boolean; sparkle?: number }> = ({ host = Host.name, cwd = Host.home, local, sparkle }) => (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: HEADER_H }}>
        <div style={{ position: "absolute", left: 12, top: 0, height: HEADER_H, display: "flex", alignItems: "center", gap: 7 }}>
            {local ? <IconTerminal size={14} color={T.muted} /> : <IconArrows size={14} color="#5fafff" />}
            <span style={sans(12.5, 500, T.fg)}>{host}</span>
            {!local && <IconShield size={13} color={T.accent} />}
            <span style={{ ...mono(12, T.secondary), lineHeight: "16px", marginLeft: 3 }}>{cwd}</span>
        </div>
        <HeaderIcons sparkle={sparkle} />
    </div>
);

export type CmdState = { kind: "running"; seconds: number } | { kind: "done"; label: string } | { kind: "failed"; code: number };

export const CMDBAR_H = 34;

export const CmdBar: React.FC<{ command: string; state: CmdState; frame: number; fix?: number; top?: number }> = ({ command, state, frame, fix = 0, top = HEADER_H }) => {
    let icon: React.ReactNode;
    let sub: React.ReactNode;
    if (state.kind === "running") {
        icon = <IconSpinner t={frame} size={14} color="#3d8bff" />;
        sub = (
            <>
                Running <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatDuration(state.seconds)}</span>
            </>
        );
    } else if (state.kind === "done") {
        icon = <IconCircleCheck size={14} color="#5fbf6a" />;
        sub = state.label;
    } else {
        icon = <IconCircleX size={14} color={T.red} />;
        sub = <span style={{ color: "#ff7a66" }}>Exit {state.code}</span>;
    }
    return (
        <div
            style={{
                position: "absolute",
                left: 6,
                right: 6,
                top,
                height: CMDBAR_H,
                borderRadius: 7,
                background: "rgba(255,255,255,0.035)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
            }}
        >
            <div style={{ position: "absolute", left: 10, top: 10 }}>{icon}</div>
            <div style={{ position: "absolute", left: 34, top: 3, ...mono(12.5, T.fg), lineHeight: "16px" }}>{command}</div>
            <div style={{ position: "absolute", left: 34, top: 18, ...sans(10.5, 400, T.muted), lineHeight: "13px" }}>{sub}</div>
            {state.kind === "failed" && fix > 0 ? (
                <div
                    style={{
                        position: "absolute",
                        right: 8,
                        top: 6,
                        height: 22,
                        padding: "0 10px 0 8px",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: `rgba(41,151,255,${0.16 + 0.22 * Math.max(0, fix - 1)})`,
                        opacity: Math.min(1, fix),
                        ...sans(11.5, 500, "#cfe6ff"),
                    }}
                >
                    <IconSparkle size={12} color="#7cc0ff" />
                    Fix with AI
                </div>
            ) : (
                <div style={{ position: "absolute", right: 12, top: 11, display: "flex", gap: 14, color: T.muted }}>
                    <IconCopy size={12} />
                </div>
            )}
        </div>
    );
};

export function formatDuration(s: number): string {
    if (s < 60) {
        return `${s.toFixed(1)}s`;
    }
    const m = Math.floor(s / 60);
    if (m < 60) {
        return `${m}m ${Math.floor(s % 60)}s`;
    }
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ---------- terminal text ----------

export type Span = { t: string; c?: string; b?: boolean; bg?: string };
export type Line = Span[];

const Palette: Record<string, string> = {
    g: T.promptUser,
    b: T.promptPath,
    d: T.termDim,
    r: T.red,
    y: T.yellow,
    c: T.cyan,
    w: "#f5f5f7",
    a: "#7cc0ff",
};

// "{g}ml@atlas{/} {b}~/llm{/} $ ls" → spans. A letter after { picks a palette color; {/} resets.
export function md(src: string): Line {
    const out: Line = [];
    const re = /\{([a-z/])\}/g;
    let color: string | undefined;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        if (m.index > last) {
            out.push({ t: src.slice(last, m.index), c: color });
        }
        color = m[1] === "/" ? undefined : Palette[m[1]];
        last = re.lastIndex;
    }
    if (last < src.length) {
        out.push({ t: src.slice(last), c: color });
    }
    return out;
}

export const prompt = (cmd = "", host = Host.name, cwd = Host.cwd): Line => [...md(`{g}${Host.user}@${host}{/} {b}${cwd}{/} $ `), ...(cmd ? [{ t: cmd }] : [])];

export const lineLength = (l: Line) => l.reduce((n, s) => n + s.t.length, 0);

// Draws lines on the terminal's cell grid. `chars` limits how much of the last line is typed.
export const TermText: React.FC<{
    lines: Line[];
    x?: number;
    y?: number;
    // how many characters of the final line are visible (typing), default all
    typed?: number;
    caret?: boolean | number;
    lineOpacity?: (i: number) => number;
}> = ({ lines, x = 14, y = HEADER_H + 10, typed, caret, lineOpacity }) => {
    const lastIdx = lines.length - 1;
    let caretCol = 0;
    const rows = lines.map((line, i) => {
        let budget = i === lastIdx && typed != null ? typed : Infinity;
        const spans: React.ReactNode[] = [];
        let col = 0;
        line.forEach((s, j) => {
            if (budget <= 0) return;
            const t = s.t.slice(0, budget);
            budget -= t.length;
            col += t.length;
            spans.push(
                <span key={j} style={{ color: s.c ?? T.termFg, fontWeight: s.b ? 700 : 400, background: s.bg }}>
                    {t}
                </span>
            );
        });
        if (i === lastIdx) caretCol = col;
        return (
            <div key={i} style={{ position: "absolute", left: 0, top: i * CELL_H, height: CELL_H, opacity: lineOpacity ? lineOpacity(i) : 1 }}>
                {spans}
            </div>
        );
    });
    const caretOn = caret === true ? 1 : typeof caret === "number" ? caret : 0;
    return (
        <div style={{ position: "absolute", left: x, top: y, ...mono() }}>
            {rows}
            {caretOn > 0 && (
                <div style={{ position: "absolute", left: caretCol * CELL_W, top: lastIdx * CELL_H + 1, width: CELL_W, height: CELL_H - 2, background: "#e8e8e8", opacity: caretOn }} />
            )}
        </div>
    );
};

// Blinking caret as the app draws it: on 530 ms, off 530 ms, always on while typing.
export const caretBlink = (frame: number, since = 0) => ((Math.floor((frame - since) / 32) % 2 === 0 ? 1 : 0));
