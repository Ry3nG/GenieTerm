import React from "react";
import { MonoFamily } from "../lib/fonts";
import {
    IconArrows,
    IconChevron,
    IconCircleCheck,
    IconFile,
    IconFolder,
    IconSparkle,
    IconTerminal,
    IconX,
    IconArrowUp,
    IconLink,
    IconShield,
    IconCheck,
} from "./icons";
import { T } from "./tokens";
import { Host, mono, sans } from "./ui";

// Panels of the app, each drawn from its source (classes and copy) in frontend/app.

const modalBg = "#232325";

// ---------- connection picker (modals/typeaheadmodal.scss) ----------

export const ConnPicker: React.FC<{ typed: string; selected: number; caret: number }> = ({ typed, selected, caret }) => {
    const item = (i: number, icon: React.ReactNode, name: string, desc?: string) => (
        <div
            key={name}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 4,
                background: i === selected ? "rgba(41,151,255,0.5)" : "transparent",
            }}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", ...sans(12, 400, T.fg) }}>
                    {icon}
                    {name}
                </div>
                {desc && <div style={{ ...sans(10.5, 400, i === selected ? "rgba(255,255,255,0.75)" : T.muted), paddingLeft: 22 }}>{desc}</div>}
            </div>
        </div>
    );
    return (
        <div
            style={{
                width: 300,
                padding: 6,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: modalBg,
                boxShadow: "0 13px 32px rgba(0,0,0,0.5)",
            }}
        >
            <div style={{ height: 28, display: "flex", alignItems: "center", padding: "0 6px", borderBottom: "1px solid rgba(255,255,255,0.08)", ...sans(12.5, 400, T.fg) }}>
                {typed ? typed : <span style={{ color: T.muted }}>Connect to (username@host)…</span>}
                <span style={{ display: "inline-block", width: 1.5, height: 15, background: T.fg, marginLeft: 1, opacity: caret }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6 }}>
                <div>
                    <div style={{ ...sans(11, 500, "rgba(255,255,255,0.7)"), padding: "4px 0 4px 4px" }}>Local</div>
                    {item(0, <IconTerminal size={14} color={T.secondary} />, "Local terminal")}
                </div>
                <div>
                    <div style={{ ...sans(11, 500, "rgba(255,255,255,0.7)"), padding: "4px 0 4px 4px" }}>Remote</div>
                    {item(1, <IconArrows size={14} color="#5fafff" />, Host.name, `${Host.user}@${Host.name}`)}
                    {item(2, <IconArrows size={14} color={T.secondary} />, "build-01", "ci@build-01")}
                    {item(3, <IconArrows size={14} color={T.secondary} />, "lab-pi", "pi@lab-pi")}
                </div>
            </div>
        </div>
    );
};

// ---------- files ----------

export type FileRow = { name: string; dir?: boolean; perm: string; mod: string; size: string; type: string };

export const FilmFiles: FileRow[] = [
    { name: "configs", dir: true, perm: "drwxr-xr-x", mod: "Today 21:50", size: "—", type: "Folder" },
    { name: "data", dir: true, perm: "drwxr-xr-x", mod: "Today 21:12", size: "—", type: "Folder" },
    { name: "runs", dir: true, perm: "drwxr-xr-x", mod: "Today 22:59", size: "—", type: "Folder" },
    { name: "config.yaml", perm: "-rw-r--r--", mod: "Today 21:50", size: "412 B", type: "YAML" },
    { name: "eval.py", perm: "-rw-r--r--", mod: "Today 21:50", size: "1.9 KB", type: "PY file" },
    { name: "README.md", perm: "-rw-r--r--", mod: "Today 21:50", size: "244 B", type: "Markdown" },
    { name: "requirements.txt", perm: "-rw-r--r--", mod: "Today 21:50", size: "31 B", type: "Plain text" },
    { name: "train.py", perm: "-rw-r--r--", mod: "Today 21:18", size: "2.2 KB", type: "PY file" },
];

export const FilesView: React.FC<{ rows?: FileRow[]; selected?: string; select?: number; arriving?: { name: string; progress: number } }> = ({
    rows = FilmFiles,
    selected,
    select = 1,
    arriving,
}) => {
    const cols = [
        { k: "name", x: 16, w: 200, label: "Name ↑" },
        { k: "perm", x: 236, w: 100, label: "Perm" },
        { k: "mod", x: 346, w: 120, label: "Last Modified" },
        { k: "size", x: 456, w: 70, label: "Size", right: true },
        { k: "type", x: 560, w: 90, label: "Type" },
    ];
    const all = arriving ? [...rows.slice(0, 2), { name: arriving.name, perm: "-rw-r--r--", mod: "Just now", size: "1.2 GB", type: "Archive" } as FileRow, ...rows.slice(2)] : rows;
    return (
        <div style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", left: 12, top: 0, height: 30, display: "flex", alignItems: "center", gap: 10 }}>
                <IconChevron dir="left" size={12} color={T.muted} />
                <IconChevron dir="right" size={12} color={T.muted} />
                <IconArrows size={13} color="#5fafff" />
                <span style={sans(12.5, 500)}>{Host.name}</span>
                <span style={{ ...mono(12, T.secondary), lineHeight: "16px" }}>{Host.cwd}</span>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 30, height: 26, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {cols.map((c) => (
                    <div key={c.k} style={{ position: "absolute", left: c.x + 26 * (c.k === "name" ? 1 : 0), top: 6, width: c.w, textAlign: c.right ? "right" : "left", ...sans(11, 500, T.muted) }}>
                        {c.label}
                    </div>
                ))}
            </div>
            {all.map((r, i) => {
                const isSel = r.name === selected;
                const isNew = arriving && r.name === arriving.name;
                return (
                    <div
                        key={r.name}
                        style={{
                            position: "absolute",
                            left: 6,
                            right: 6,
                            top: 60 + i * 26,
                            height: 26,
                            borderRadius: 5,
                            background: isSel ? `rgba(41,151,255,${0.45 * select})` : "transparent",
                        }}
                    >
                        <div style={{ position: "absolute", left: 10, top: 6 }}>
                            {r.dir ? <IconFolder size={14} color="#6aa7f8" /> : <IconFile size={14} color={isNew ? "#e0b956" : "#8e8e93"} />}
                        </div>
                        {cols.map((c) => (
                            <div
                                key={c.k}
                                style={{
                                    position: "absolute",
                                    left: c.x + (c.k === "name" ? 26 : 0) - 6,
                                    top: 5,
                                    width: c.w,
                                    textAlign: c.right ? "right" : "left",
                                    ...(c.k === "perm" ? { ...mono(11.5, T.muted), lineHeight: "16px" } : sans(12, c.k === "name" ? 450 : 400, c.k === "name" ? T.fg : T.secondary)),
                                }}
                            >
                                {(r as unknown as Record<string, string>)[c.k]}
                            </div>
                        ))}
                        {isNew && arriving.progress < 1 && (
                            <div style={{ position: "absolute", left: 30, right: 10, bottom: 1, height: 2, borderRadius: 1, background: "rgba(255,255,255,0.08)" }}>
                                <div style={{ width: `${arriving.progress * 100}%`, height: "100%", borderRadius: 1, background: T.accent }} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// ---------- editor ----------

const Yaml = { key: "#9cdcfe", str: "#ce9178", num: "#b5cea8", com: "#6a9955" };

export const EditorView: React.FC<{ lr: string; caretOn: number; dirty: boolean; saved: number }> = ({ lr, caretOn, dirty, saved }) => {
    const lines: [string, string, string?][] = [
        ["# training run", "com"],
        ["model:", "key"],
        ["  layers: ", "key", "12"],
        ["  width: ", "key", "768"],
        ["  context: ", "key", "512"],
        ["", "key"],
        ["optim:", "key"],
        ["  lr: ", "key", lr],
        ["  warmup: ", "key", "400"],
        ["  weight_decay: ", "key", "0.1"],
        ["", "key"],
        ["data: ", "key", "data/shards"],
        ["epochs: ", "key", "100"],
        ["precision: ", "key", "bf16"],
    ];
    return (
        <div style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", left: 12, right: 10, top: 0, height: 30, display: "flex", alignItems: "center", gap: 10 }}>
                <IconChevron dir="left" size={12} color={T.muted} />
                <IconArrows size={13} color="#5fafff" />
                <span style={sans(12.5, 500)}>{Host.name}</span>
                <span style={{ ...mono(12, T.secondary), lineHeight: "16px" }}>{Host.cwd}/config.yaml</span>
                {dirty && <span style={{ width: 7, height: 7, borderRadius: 4, background: T.fg, opacity: 0.8 }} />}
                <div style={{ flex: 1 }} />
                <div
                    style={{
                        height: 22,
                        padding: "0 12px",
                        borderRadius: 5,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: dirty ? `rgba(41,151,255,${0.8 + 0.2 * saved})` : "rgba(255,255,255,0.08)",
                        ...sans(11.5, 500, dirty ? "#fff" : T.secondary),
                    }}
                >
                    {!dirty && saved > 0 ? <IconCheck size={11} color="#87d787" /> : null}
                    {!dirty && saved > 0 ? "Saved" : "Save"}
                </div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 34, bottom: 0 }}>
                {lines.map(([a, kind, v], i) => (
                    <div key={i} style={{ position: "absolute", left: 0, top: 6 + i * 19, height: 19, right: 0, background: i === 7 ? "rgba(255,255,255,0.04)" : "transparent" }}>
                        <span style={{ position: "absolute", left: 0, width: 36, textAlign: "right", ...mono(12, i === 7 ? T.secondary : "#5a5a5e"), lineHeight: "19px" }}>{i + 1}</span>
                        <span style={{ position: "absolute", left: 52, ...mono(13, kind === "com" ? Yaml.com : Yaml.key), lineHeight: "19px" }}>
                            {a}
                            {v != null && <span style={{ color: /^[\d.e-]+$/.test(v) ? Yaml.num : Yaml.str }}>{v}</span>}
                            {i === 7 && <span style={{ display: "inline-block", width: 1.5, height: 15, background: T.fg, opacity: caretOn, verticalAlign: "-2px" }} />}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ---------- forward offer dock (view/term/term.tsx TermForwardDock) ----------

export const ForwardDock: React.FC<{ status: "offer" | "busy" | "forwarded"; press?: number }> = ({ status, press = 0 }) => {
    const forwarded = status === "forwarded";
    return (
        <div
            style={{
                width: 560,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 8px 8px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.09)",
                background: modalBg,
                boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            }}
        >
            {forwarded ? (
                <IconCircleCheck size={13} color="#5fbf6a" />
            ) : (
                <svg width={13} height={13} viewBox="0 0 24 24" style={{ display: "block", opacity: status === "busy" ? 0.6 : 1 }}>
                    <circle cx="12" cy="12" r="9.5" fill="none" stroke={T.accent} strokeWidth={2.2} />
                    <path d="M2.5 12h19M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19" fill="none" stroke={T.accent} strokeWidth={1.8} />
                </svg>
            )}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: 1 }}>
                <span style={{ ...mono(12.5, T.fg), lineHeight: "16px" }}>localhost:6006</span>
                <span style={sans(12, 400, T.muted)}>{forwarded ? `forwarded from ${Host.name}` : `on ${Host.name}`}</span>
            </div>
            <div
                style={{
                    height: 28,
                    padding: "0 10px",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    background: forwarded ? "rgba(255,255,255,0.06)" : `rgba(41,151,255,${0.8 + 0.2 * press})`,
                    transform: `scale(${1 - 0.05 * press})`,
                    ...sans(12, 500, forwarded ? T.secondary : T.fg),
                }}
            >
                {status === "busy" ? "Opening…" : forwarded ? "Open" : "Open in Browser"}
            </div>
            <div style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IconX size={12} color={T.muted} />
            </div>
        </div>
    );
};

// ---------- a browser window showing the run's loss curve (TensorBoard, redrawn) ----------

export const BrowserWindow: React.FC<{ width: number; height: number; children: React.ReactNode; url?: string }> = ({ width, height, children, url = "localhost:6006" }) => (
    <div
        style={{
            width,
            height,
            borderRadius: 12,
            overflow: "hidden",
            background: "#f7f7f8",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.5), 0 40px 120px rgba(0,0,0,0.6), 0 12px 30px rgba(0,0,0,0.35)",
            position: "relative",
        }}
    >
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 40, background: "#2a2a2c", borderBottom: "1px solid rgba(0,0,0,0.4)" }}>
            <div style={{ position: "absolute", left: 14, top: 14, display: "flex", gap: 8 }}>
                {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                    <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
                ))}
            </div>
            <div
                style={{
                    position: "absolute",
                    left: "50%",
                    top: 8,
                    transform: "translateX(-50%)",
                    width: 340,
                    height: 24,
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    ...sans(12, 400, "rgba(255,255,255,0.85)"),
                }}
            >
                {url}
            </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 40, bottom: 0 }}>{children}</div>
    </div>
);

// ---------- Command AI sheet (view/term/command-composer-ui.tsx) ----------

export type Engine = { id: string; label: string; status: string; kind: "cli" | "local" };

// The first-use setup view lists exactly these three; API keys live behind "Open Settings".
export const Engines: Engine[] = [
    { id: "codex", label: "Codex", status: "Signed in", kind: "cli" },
    { id: "claude", label: "Claude Code", status: "Signed in", kind: "cli" },
    { id: "ollama", label: "Ollama", status: "Running on this computer", kind: "local" },
];

const EngineIcon: React.FC<{ kind: Engine["kind"]; color: string }> = ({ kind, color }) =>
    kind === "local" ? (
        <svg width={14} height={14} viewBox="0 0 24 24" style={{ display: "block", marginTop: 2 }}>
            <rect x="5" y="5" width="14" height="14" rx="2.5" fill={color} />
            <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" stroke={color} strokeWidth={2} strokeLinecap="round" />
            <rect x="9" y="9" width="6" height="6" rx="1" fill="#232325" />
        </svg>
    ) : (
        <IconTerminal size={14} color={color} style={{ marginTop: 2 }} />
    );

export const EnginePicker: React.FC<{ hover?: string; picked?: string; pick?: number; reveal?: (i: number) => number }> = ({ hover, picked, pick = 0, reveal }) => (
    <div style={{ padding: 16 }}>
        <div style={sans(14, 600)}>Choose the AI that writes your commands</div>
        <div style={{ ...sans(12, 400, T.secondary), marginTop: 4, whiteSpace: "normal", lineHeight: "18px", maxWidth: 560 }}>
            GenieTerm has no AI service of its own. It uses one you already have, and sends a request only when you ask.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
            {Engines.map((e, i) => {
                const isPick = e.id === picked;
                const hot = e.id === hover || isPick;
                const r = reveal ? reveal(i) : 1;
                return (
                    <div
                        key={e.id}
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: `1px solid ${hot ? `rgba(41,151,255,${0.6 + 0.3 * pick})` : "rgba(255,255,255,0.1)"}`,
                            background: hot ? `rgba(41,151,255,${0.1 + 0.08 * pick})` : "rgba(255,255,255,0.04)",
                            opacity: r,
                            transform: `translateY(${(1 - r) * 10}px) scale(${isPick ? 1 - 0.03 * Math.sin(Math.PI * Math.min(1, pick * 2)) : 1})`,
                        }}
                    >
                        <EngineIcon kind={e.kind} color={T.accent} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={sans(13, 500)}>{e.label}</div>
                            <div style={sans(11.5, 400, T.secondary)}>{e.status}</div>
                        </div>
                        <div style={{ alignSelf: "center", ...sans(12, 500, T.accent) }}>Use</div>
                    </div>
                );
            })}
        </div>
        <div style={{ marginTop: 14, ...sans(12, 400, T.muted) }}>
            Rather use an API key or your own server? <span style={{ color: T.accent }}>Open Settings</span>
        </div>
    </div>
);

// `height`, when given, fixes the sheet's height so a film can spring it between states the
// way a resizing panel would; the body takes the slack and the footer stays at the bottom.
export const SheetFrame: React.FC<{ title: React.ReactNode; width?: number; height?: number; bodyAlpha?: number; footer?: React.ReactNode; input?: React.ReactNode; children: React.ReactNode }> = ({
    title,
    width = 720,
    height,
    bodyAlpha = 1,
    footer,
    input,
    children,
}) => (
    <div
        style={{
            width,
            height,
            display: "flex",
            flexDirection: "column",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.09)",
            background: "rgba(35,35,37,0.97)",
            boxShadow: "0 18px 50px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(0,0,0,0.6)",
            overflow: "hidden",
            fontSize: 13,
        }}
    >
        <div style={{ height: 36, display: "flex", alignItems: "center", gap: 8, padding: "0 6px 0 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <IconSparkle size={12} color={T.accent} />
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>{title}</div>
            <div style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <IconX size={12} color={T.muted} />
            </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", opacity: bodyAlpha }}>{children}</div>
        {input}
        <div style={{ opacity: bodyAlpha }}>{footer}</div>
    </div>
);

export const RiskBadge: React.FC<{ label: string; level: "caution" | "danger" }> = ({ label, level }) => (
    <span
        style={{
            borderRadius: 999,
            padding: "2px 8px",
            whiteSpace: "nowrap",
            ...sans(11, 500, level === "danger" ? "#ff7a66" : T.warning),
            background: level === "danger" ? "rgba(229,77,46,0.15)" : "rgba(224,185,86,0.13)",
        }}
    >
        {label}
    </span>
);

const SheetButton: React.FC<{ children: React.ReactNode; primary?: boolean; hint?: string; press?: number }> = ({ children, primary, hint, press = 0 }) => (
    <span
        style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            borderRadius: 6,
            background: primary ? `rgba(41,151,255,${0.8 + 0.2 * press})` : "rgba(255,255,255,0.06)",
            transform: `scale(${1 - 0.05 * press})`,
            ...sans(12, 500, primary ? T.fg : T.secondary),
        }}
    >
        {children}
        {hint && <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.6 }}>{hint}</span>}
    </span>
);

export type Proposal = { command: string; note: string; risk?: { label: string; level: "caution" | "danger" } };

export const SheetAnswer: React.FC<{ explain: string; shown: number; proposals: Proposal[]; reveal: number; selected: number; insertPress?: number }> = ({
    explain,
    shown,
    proposals,
    reveal,
    selected,
    insertPress = 0,
}) => (
    <div style={{ padding: 6 }}>
        <div style={{ padding: "6px 10px 8px", ...sans(13, 400, T.fg), whiteSpace: "normal", lineHeight: "20px" }}>{renderInlineCode(explain.slice(0, shown))}</div>
        {proposals.map((p, i) => {
            const r = Math.max(0, Math.min(1, reveal - i * 0.35));
            const sel = i === selected;
            return (
                <div
                    key={i}
                    style={{
                        position: "relative",
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: sel ? "rgba(255,255,255,0.055)" : "transparent",
                        opacity: r,
                        transform: `translateY(${(1 - r) * 8}px)`,
                    }}
                >
                    {sel && <span style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 2, borderRadius: 1, background: T.accent }} />}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <code style={{ flex: 1, fontFamily: MonoFamily, fontSize: 12.5, lineHeight: "20px", color: T.fg }}>
                            {p.command.split(" ").map((w, k) => (
                                <React.Fragment key={k}>
                                    {k > 0 && " "}
                                    <span style={{ whiteSpace: "nowrap" }}>{w}</span>
                                </React.Fragment>
                            ))}
                        </code>
                        {p.risk && <RiskBadge {...p.risk} />}
                    </div>
                    <div style={{ marginTop: 4, ...sans(12, 400, T.secondary), whiteSpace: "normal", lineHeight: "18px" }}>{p.note}</div>
                    {sel && (
                        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                            <SheetButton primary hint="↵" press={insertPress}>
                                Insert
                            </SheetButton>
                            <SheetButton hint="⌘↵">Run</SheetButton>
                            <SheetButton>
                                <span style={{ fontSize: 11 }}>Copy</span>
                            </SheetButton>
                        </div>
                    )}
                </div>
            );
        })}
    </div>
);

function renderInlineCode(s: string): React.ReactNode {
    const parts = s.split("`");
    return parts.map((p, i) =>
        i % 2 === 1 ? (
            <code key={i} style={{ fontFamily: MonoFamily, fontSize: "0.92em", padding: "1px 4px", borderRadius: 4, background: "rgba(255,255,255,0.07)" }}>
                {p}
            </code>
        ) : (
            <React.Fragment key={i}>{p}</React.Fragment>
        )
    );
}

export const SheetFooter: React.FC<{ engine: string }> = ({ engine }) => (
    <div style={{ height: 32, display: "flex", alignItems: "center", gap: 12, padding: "0 14px", borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.12)", ...sans(11, 400, T.muted) }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <IconShield size={10} color={T.muted} />
            Remote host over SSH · Ubuntu 24.04 · bash
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: T.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <IconCheck size={9} color="#fff" />
            </span>
            Include output
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.2)" }}>What's sent</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px", borderRadius: 5, background: "rgba(255,255,255,0.05)", color: T.secondary }}>{engine}</span>
    </div>
);

export const SheetThinking: React.FC<{ frame: number; label: string }> = ({ frame, label }) => (
    <div style={{ padding: "16px 16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ position: "relative", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span
                    style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: 8,
                        background: T.accent,
                        opacity: 0.3 * (1 - ((frame % 60) / 60)),
                        transform: `scale(${1 + ((frame % 60) / 60) * 0.9})`,
                    }}
                />
                <span style={{ width: 8, height: 8, borderRadius: 4, background: T.accent }} />
            </span>
            <span style={sans(13, 400)}>{label}</span>
        </div>
        <div style={{ marginTop: 14, paddingLeft: 28, display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ height: 11, width: "72%", borderRadius: 4, background: `rgba(255,255,255,${0.05 + 0.02 * Math.sin(frame / 9)})` }} />
            <div style={{ height: 11, width: "48%", borderRadius: 4, background: `rgba(255,255,255,${0.04 + 0.02 * Math.sin(frame / 9 + 1)})` }} />
        </div>
    </div>
);

export const SheetTitleFix: React.FC<{ command: string }> = ({ command }) => (
    <>
        <span style={sans(12, 600)}>Fix</span>
        <code style={{ fontFamily: MonoFamily, fontSize: 12, color: T.secondary }}>{command}</code>
        <span style={{ borderRadius: 4, padding: "1px 6px", background: "rgba(229,77,46,0.15)", fontFamily: MonoFamily, fontSize: 10.5, color: "#ff7a66" }}>exit 1</span>
    </>
);

// ---------- inline suggestion under the prompt (TermInlineAIDock) ----------

export const InlineSuggestion: React.FC<{ state: "thinking" | "ready"; prompt: string; command: string; note: string; press?: number }> = ({ state, prompt, command, note, press = 0 }) => (
    <div
        style={{
            width: 640,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 8px 8px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.09)",
            background: modalBg,
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
        }}
    >
        <IconSparkle size={13} color={T.accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
            {state === "thinking" ? (
                <div style={sans(12.5, 400, T.secondary)}>Turning “{prompt}” into a command…</div>
            ) : (
                <>
                    <div style={{ ...mono(12.5, T.fg), lineHeight: "17px" }}>{command}</div>
                    <div style={sans(11.5, 400, T.muted)}>{note}</div>
                </>
            )}
        </div>
        {state === "ready" && (
            <>
                <SheetButton primary press={press}>
                    Insert
                </SheetButton>
                <SheetButton>Run</SheetButton>
            </>
        )}
        <div style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconX size={12} color={T.muted} />
        </div>
    </div>
);

// ---------- toast ----------

export const Toast: React.FC<{ icon: React.ReactNode; text: string; sub?: string }> = ({ icon, text, sub }) => (
    <div
        style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px 8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.09)",
            background: modalBg,
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        }}
    >
        {icon}
        <span style={sans(12.5, 500)}>{text}</span>
        {sub && <span style={sans(12, 400, T.muted)}>{sub}</span>}
    </div>
);

export { IconArrowUp, IconLink };
