import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Pointer, cursorAt } from "../lib/cursor";
import { MonoFamily } from "../lib/fonts";
import { IconFile, IconFolder, IconUpload } from "../kit/icons";
import { Label } from "../kit/label";
import { Ease, FPS, Spring, mix, ramp, springAt } from "../kit/motion";
import { EditorView, FilesView, type FileRow } from "../kit/panels";
import { Studio, World, camPath, recede, toScreen, withDrift } from "../kit/stage";
import { T } from "../kit/tokens";
import { AppWindow, Block, TermHeader, TermText, prompt, sans, tileRect } from "../kit/ui";
import { Scrim, WindowShadow, blockOrigin } from "../v3/workspace";

// Remote files without scp: a dataset shard dragged from the Downloads folder straight onto the
// server's folder (the app's own "Drop to upload" overlay and transfer queue), then a config
// value changed and saved in place.

export const F = {
    pick: 90,
    drop: 210,
    upload: [218, 430] as const,
    dbl: 520,
    editor: 528,
    select: 604,
    type: 626,
    save: 692,
    label: 770,
    end: 1040,
};

const FILE = "shards-0064.tar";
const SIZE_GB = 1.2;

const Downloads: React.FC<{ dragging: number }> = ({ dragging }) => (
    <div
        style={{
            position: "absolute",
            left: -560,
            top: 250,
            width: 460,
            height: 330,
            borderRadius: 12,
            background: "#2a2a2c",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08), 0 40px 100px rgba(0,0,0,0.6)",
            overflow: "hidden",
        }}
    >
        <div style={{ height: 40, display: "flex", alignItems: "center", padding: "0 14px", gap: 8, background: "#323234", borderBottom: "1px solid rgba(0,0,0,0.35)" }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
            ))}
            <span style={{ marginLeft: 12, ...sans(13, 600, "rgba(255,255,255,0.85)") }}>Downloads</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, padding: "26px 22px" }}>
            {[
                { n: FILE, big: true },
                { n: "paper-draft.pdf" },
                { n: "eval-results.csv" },
                { n: "photos", dir: true },
                { n: "notes.md" },
            ].map((f) => (
                <div key={f.n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, opacity: f.n === FILE ? 1 - 0.55 * dragging : 1 }}>
                    <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: f.n === FILE && dragging < 0.5 ? "rgba(41,151,255,0.18)" : "transparent" }}>
                        {f.dir ? <IconFolder size={50} color="#6aa7f8" /> : <IconFile size={48} color={f.n === FILE ? "#e0b956" : "#c7c7cc"} />}
                    </div>
                    <span style={{ ...sans(12, 500, "rgba(255,255,255,0.85)"), maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{f.n}</span>
                </div>
            ))}
        </div>
    </div>
);

const DropOverlay: React.FC<{ a: number }> = ({ a }) => (
    <div
        style={{
            position: "absolute",
            inset: 8,
            borderRadius: 6,
            border: `1px dashed rgba(41,151,255,${a})`,
            background: `rgba(14,14,15,${0.72 * a})`,
            boxShadow: `inset 0 0 0 1px rgba(41,151,255,${0.16 * a})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: a,
        }}
    >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(41,151,255,0.32)", background: T.bg, ...sans(12, 500) }}>
            <IconUpload size={13} color={T.accent} />
            Drop to upload
        </div>
    </div>
);

// The directory view's transfer queue, the strip above the file list (transfer-queue-status.tsx).
const TransferStrip: React.FC<{ p: number; a: number }> = ({ p, a }) => {
    const done = p >= 1;
    const pct = Math.round(p * 100);
    return (
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 64, padding: "8px 10px", boxSizing: "border-box", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)", opacity: a }}>
            <div style={{ display: "flex", justifyContent: "space-between", ...sans(11, 600) }}>
                <span>Transfers</span>
                <span style={{ fontWeight: 400, color: T.secondary }}>{done ? "1 done" : "1 active"}</span>
            </div>
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <IconUpload size={12} color={done ? "#5fbf6a" : T.accent} />
                <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", ...sans(11.5, 500) }}>
                        <span style={{ fontFamily: MonoFamily }}>{FILE}</span>
                        <span style={{ color: done ? "#7fd18a" : T.secondary, fontWeight: 400 }}>{done ? "Uploaded" : "Uploading"}</span>
                    </div>
                    <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }}>
                        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: done ? "#5fbf6a" : T.accent }} />
                    </div>
                </div>
                <span style={{ width: 120, textAlign: "right", ...sans(11, 400, T.muted), fontVariantNumeric: "tabular-nums" }}>
                    {done ? `${SIZE_GB} GB` : `${pct}% · ${(SIZE_GB * p).toFixed(2)} GB`}
                </span>
            </div>
        </div>
    );
};

export const FilesShort: React.FC = () => {
    const f = useCurrentFrame();
    const fadeIn = ramp(f, 0, 30, Ease.glide);
    const exit = ramp(f, F.end - 34, F.end - 2, Ease.glide);

    const term = tileRect({}, 0, 0.56);
    const filesFull = tileRect({}, 0.56, 1);
    const editorSplit = mix(1, 0.5, springAt(f, F.editor, Spring.large));
    const files = tileRect({}, 0.56, 1, 0, editorSplit);
    const editor = tileRect({}, 0.56, 1, editorSplit, 1);
    const editorIn = ramp(f, F.editor + 4, F.editor + 40, Ease.enter);
    const fo = blockOrigin(filesFull);
    const eo = blockOrigin(tileRect({}, 0.56, 1, 0.5, 1));

    const progress = ramp(f, F.upload[0], F.upload[1], Ease.move);
    const stripA = ramp(f, F.drop, F.drop + 14, Ease.out) * (1 - ramp(f, F.upload[1] + 50, F.upload[1] + 70, Ease.glide));
    // the list makes room for the strip and closes up after it on a spring, never a jump
    const stripShift = 64 * (springAt(f, F.drop, Spring.medium) - springAt(f, F.upload[1] + 56, Spring.large));
    const rows: FileRow[] | undefined = undefined;
    // the folder lists the file once the transfer completes, as the app refreshes it
    const arriving = f >= F.upload[1] ? { name: FILE, progress: 1 } : undefined;
    const over = ramp(f, F.drop - 50, F.drop - 36, Ease.out) * (1 - ramp(f, F.drop, F.drop + 10, Ease.linear));

    const lr = f < F.type ? "3e-4" : "6e-4".slice(0, Math.max(1, Math.min(4, Math.floor((f - F.type) / 6) + 1)));
    const dirty = f >= F.type && f < F.save + 2;

    // pointer and drag ghost, in world space
    const pick = { x: -560 + 22 + 64, y: 250 + 40 + 26 + 32 };
    const target = { x: fo.x + 300, y: fo.y + 260 };
    const pointer = cursorAt(
        [
            { f: 30, x: -300, y: 620 },
            { f: F.pick, x: pick.x, y: pick.y, dur: 50, click: true },
            { f: F.drop, x: target.x, y: target.y, dur: 110 },
            // the uploaded file now sits third, so config.yaml is the fifth row
            { f: F.dbl, x: fo.x + 90, y: fo.y + 60 + 4 * 26 + 13, dur: 60, click: true },
            { f: F.select, x: eo.x + 106, y: eo.y + 34 + 6 + 7 * 19 + 10, dur: 50, click: true },
            { f: F.save, x: eo.x + filesFull.width - 34, y: eo.y + 15, dur: 44, click: true },
        ],
        f,
        FPS
    );
    const dragging = f >= F.pick && f < F.drop ? 1 : 0;
    const pointerA = ramp(f, 30, 46, Ease.out) * (1 - ramp(f, F.save + 20, F.save + 40, Ease.exit));

    const cam = withDrift(
        camPath(f, [
            { at: 0, x: 560, y: 450, zoom: 0.84 },
            { at: F.drop - 30, x: 1150, y: 300, zoom: 1.55 },
            { at: F.editor, x: 1150, y: 600, zoom: 1.6 },
            { at: F.label - 30, x: 1000, y: 450, zoom: 1.16 },
        ]),
        f,
        0.8
    );
    const spot = ramp(f, F.label - 20, F.label + 20, Ease.move);

    const ws = (
        <>
            <Downloads dragging={dragging} />
            <WindowShadow>
                <AppWindow rail="files">
                    <Block rect={term} header={<TermHeader />}>
                        <TermText lines={[prompt("")]} caret={0} />
                    </Block>
                    <Block rect={files} focus={f < F.editor ? 1 : 0}>
                        <div style={{ position: "absolute", inset: 0, transform: `translateY(${stripShift}px)` }}>
                            <FilesView rows={rows} arriving={arriving} selected={f >= F.dbl ? "config.yaml" : undefined} />
                        </div>
                        {stripA > 0 && <TransferStrip p={progress} a={stripA} />}
                        {over > 0 && <DropOverlay a={over} />}
                    </Block>
                    {editorIn > 0 && (
                        <Block rect={editor} focus={f >= F.editor ? 1 : 0} style={{ opacity: editorIn }}>
                            <EditorView lr={lr} caretOn={f >= F.type && f < F.save ? 1 : 0} dirty={dirty} saved={f >= F.save + 2 ? 1 : 0} />
                            {f >= F.select + 4 && f < F.type && <div style={{ position: "absolute", left: 52 + 6 * 7.8, top: 34 + 6 + 7 * 19 + 2, width: 4 * 7.8, height: 16, background: "rgba(41,151,255,0.38)", borderRadius: 2 }} />}
                        </Block>
                    )}
                </AppWindow>
            </WindowShadow>
            {dragging > 0 && (
                <div style={{ position: "absolute", left: pointer.x - 30, top: pointer.y - 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity: 0.85 }}>
                    <IconFile size={44} color="#e0b956" />
                    <span style={{ ...sans(11, 500, "#fff"), padding: "1px 6px", borderRadius: 4, background: "rgba(41,151,255,0.85)" }}>{FILE}</span>
                </div>
            )}
            {pointerA > 0 && (
                <div style={{ position: "absolute", left: 0, top: 0, opacity: pointerA }}>
                    <Pointer x={pointer.x} y={pointer.y} press={pointer.press} size={16} />
                </div>
            )}
        </>
    );

    const labelAt = toScreen(cam, 70, 380);
    return (
        <AbsoluteFill style={{ background: "#000", opacity: fadeIn * (1 - exit) }}>
            <Studio />
            <AbsoluteFill style={recede(spot * 0.9)}>
                <World cam={cam}>{ws}</World>
            </AbsoluteFill>
            <Scrim x={labelAt.x} y={labelAt.y} w={640} h={140} amount={spot} />
            <Label frame={f} x={Math.max(150, labelAt.x)} y={labelAt.y} text="Drag in. Edit. Save." sub="The server's files, without scp or vim." from={F.label} to={F.end + 10} size={56} />
        </AbsoluteFill>
    );
};

