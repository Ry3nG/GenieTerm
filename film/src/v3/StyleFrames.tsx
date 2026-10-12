import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { loadFonts } from "../lib/fonts";
import { trainScreen } from "../kit/data";
import { HostView } from "../kit/host";
import { EditorView, EnginePicker, FilesView, SheetAnswer, SheetFooter, SheetFrame, SheetTitleFix } from "../kit/panels";
import { Caret, FilmGrain, Studio, World, cardText, withDrift, type Cam } from "../kit/stage";
import { T } from "../kit/tokens";
import { sans, AppWindow, Block, CMDBAR_H, CmdBar, HEADER_H, TermHeader, TermText, WIN_H, WIN_W, md, prompt, tileRect } from "../kit/ui";

loadFonts();

const failLines = [
    prompt("pip install flash-attn"),
    md("Collecting flash-attn"),
    md("  Using cached flash_attn-2.8.3.tar.gz (8.4 MB)"),
    md("  Preparing metadata (setup.py) ... {r}error{/}"),
    md("  {r}×{/} python setup.py egg_info did not run successfully."),
    md("  │ exit code: 1"),
    md("  ╰─> OSError: CUDA_HOME environment variable is not set."),
    md("      Please set it to your CUDA install root."),
    md("{r}error: metadata-generation-failed{/}"),
    prompt(""),
];

const Shadowed: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ position: "absolute", left: 0, top: 0, width: WIN_W, height: WIN_H, borderRadius: 12, boxShadow: "0 60px 160px rgba(0,0,0,0.7), 0 20px 50px rgba(0,0,0,0.4)" }}>
        {children}
    </div>
);

export const StyleFrames: React.FC = () => {
    const frame = useCurrentFrame();
    const split = 0.56;
    const left = tileRect({}, 0, split);
    const right = tileRect({}, split, 1);

    if (frame === 4) {
        return (
            <AbsoluteFill style={{ background: "#070708", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "left" }}>
                    <div style={cardText(64)}>
                        Close the lid. Keep training.
                        <Caret on={1} h={58} />
                    </div>
                </div>
                <FilmGrain />
            </AbsoluteFill>
        );
    }

    let cam: Cam = { x: WIN_W / 2, y: WIN_H / 2, zoom: 0.86, rx: 12, ry: -16, rz: 1.5 };
    let content: React.ReactNode;
    if (frame === 0) {
        content = (
            <>
                <Block rect={left} focused header={<TermHeader />}>
                    <CmdBar command="python train.py" state={{ kind: "running", seconds: 2537 }} frame={frame} />
                    <TermText lines={trainScreen(41, 40)} y={HEADER_H + CMDBAR_H + 14} />
                </Block>
                <Block rect={right}>
                    <HostView build={1} frame={frame} width={right.width} />
                </Block>
            </>
        );
    } else if (frame === 1 || frame === 2) {
        cam = { x: 480, y: 640, zoom: 1.7 };
        const sheet =
            frame === 1 ? (
                <SheetFrame title={<SheetTitleFix command="pip install flash-attn" />} footer={<SheetFooter engine="Claude Code" />}>
                    <SheetAnswer
                        explain="flash-attn tried to compile its CUDA kernels, and this machine has no `CUDA_HOME`. Install the prebuilt wheel instead of building it."
                        shown={999}
                        reveal={1}
                        selected={0}
                        proposals={[
                            {
                                command: "FLASH_ATTENTION_SKIP_CUDA_BUILD=TRUE pip install flash-attn --no-build-isolation",
                                note: "Skips the CUDA build and uses the wheel that matches your torch.",
                                risk: { label: "Installs or removes software", level: "caution" },
                            },
                        ]}
                    />
                </SheetFrame>
            ) : (
                <SheetFrame title={<span style={sans(12, 600)}>Command AI</span>}>
                    <EnginePicker hover="claude" />
                </SheetFrame>
            );
        content = (
            <Block rect={left} focused header={<TermHeader />}>
                <CmdBar command="pip install flash-attn" state={{ kind: "failed", code: 1 }} frame={frame} fix={1} />
                <TermText lines={failLines} y={HEADER_H + CMDBAR_H + 14} caret />
                <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, display: "flex", justifyContent: "center" }}>{sheet}</div>
            </Block>
        );
    } else {
        cam = { x: 1100, y: 330, zoom: 1.6 };
        content = (
            <>
                <Block rect={left} header={<TermHeader />}>
                    <TermText lines={[prompt("")]} y={HEADER_H + 14} caret />
                </Block>
                <Block rect={tileRect({}, split, 1, 0, 0.5)} focused>
                    <FilesView selected="config.yaml" />
                </Block>
                <Block rect={tileRect({}, split, 1, 0.5, 1)}>
                    <EditorView lr="6e-4" caretOn={1} dirty saved={0} />
                </Block>
            </>
        );
    }

    return (
        <AbsoluteFill>
            <Studio />
            <World cam={withDrift(cam, 0)}>
                <Shadowed>
                    <AppWindow rail={frame === 0 ? "host" : frame === 3 ? "files" : "terminal"}>{content}</AppWindow>
                </Shadowed>
            </World>
            <FilmGrain />
        </AbsoluteFill>
    );
};
