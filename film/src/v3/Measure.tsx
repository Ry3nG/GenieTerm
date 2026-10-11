import React from "react";
import { AbsoluteFill } from "remotion";
import { loadFonts } from "../lib/fonts";
import { EnginePicker, SheetAnswer, SheetFooter, SheetFrame, SheetThinking, SheetTitleFix } from "../kit/panels";
import { sans } from "../kit/ui";

loadFonts();

// Lays the Command AI sheet's three states side by side at 1:1 so their heights can be read.
export const Measure: React.FC = () => (
    <AbsoluteFill style={{ background: "#ff00ff" }}>
        {[0, 1, 2].map((i) => (
            <div key={i} style={{ position: "absolute", left: 20, top: 20 + i * 340, transform: "scale(0.5)", transformOrigin: "0 0" }}>
                {i === 0 && (
                    <SheetFrame title={<span style={sans(12, 600)}>Command AI</span>}>
                        <EnginePicker />
                    </SheetFrame>
                )}
                {i === 1 && (
                    <SheetFrame title={<SheetTitleFix command="pip install flash-attn" />} footer={<SheetFooter engine="Claude Code" />}>
                        <SheetThinking frame={0} label="Asking Claude Code…" />
                    </SheetFrame>
                )}
                {i === 2 && (
                    <SheetFrame title={<SheetTitleFix command="pip install flash-attn" />} footer={<SheetFooter engine="Claude Code" />}>
                        <SheetAnswer
                            explain="flash-attn tried to compile its CUDA kernels, and this machine has no `CUDA_HOME`. Install the prebuilt wheel instead of building it."
                            shown={999}
                            reveal={1}
                            selected={0}
                            proposals={[{ command: "FLASH_ATTENTION_SKIP_CUDA_BUILD=TRUE pip install flash-attn --no-build-isolation", note: "Skips the CUDA build and uses the wheel that matches your torch.", risk: { label: "Installs or removes software", level: "caution" } }]}
                        />
                    </SheetFrame>
                )}
            </div>
        ))}
    </AbsoluteFill>
);
