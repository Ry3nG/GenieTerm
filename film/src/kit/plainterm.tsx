import React from "react";
import { MonoFamily, SansFamily } from "../lib/fonts";
import type { Line } from "./ui";

// An ordinary terminal app, the "before" picture: a title bar and text, nothing else.
export const PlainTerminal: React.FC<{ lines: Line[]; caret?: number; title?: string; size?: number }> = ({ lines, caret = 0, title = "ml@atlas: ~/llm — ssh atlas — 160×48", size = 15 }) => {
    const lh = Math.round(size * 1.3);
    const last = lines.length - 1;
    const lastLen = lines[last]?.reduce((n, s) => n + s.t.length, 0) ?? 0;
    return (
        <div style={{ position: "absolute", inset: 0, background: "#1c1c1e" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 36, background: "#2b2b2d", borderBottom: "1px solid #111" }}>
                <div style={{ position: "absolute", left: 16, top: 12, display: "flex", gap: 8 }}>
                    {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                        <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
                    ))}
                </div>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SansFamily, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
                    {title}
                </div>
            </div>
            <div style={{ position: "absolute", left: 14, top: 46, fontFamily: MonoFamily, fontSize: size, lineHeight: `${lh}px`, color: "#e6e6e6", whiteSpace: "pre" }}>
                {lines.map((l, i) => (
                    <div key={i} style={{ height: lh }}>
                        {l.map((s, j) => (
                            <span key={j} style={{ color: s.c ?? "#e6e6e6", fontWeight: s.b ? 700 : 400 }}>
                                {s.t}
                            </span>
                        ))}
                        {i === last && caret > 0 && <span style={{ display: "inline-block", width: size * 0.6, height: lh - 3, background: "#d0d0d0", opacity: caret, verticalAlign: "top", marginTop: 1, marginLeft: lastLen ? 0 : 0 }} />}
                    </div>
                ))}
            </div>
        </div>
    );
};
