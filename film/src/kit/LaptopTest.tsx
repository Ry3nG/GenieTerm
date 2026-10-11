import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { loadFonts } from "../lib/fonts";
import { epochLine } from "./data";
import { LaptopShot, lidClose, lidOpen } from "./laptopshot";
import { PlainTerminal } from "./plainterm";
import { Studio } from "./stage";
import { md } from "./ui";

loadFonts();

export const LaptopTest: React.FC = () => {
    const f = useCurrentFrame();
    const lid = f < 70 ? lidClose(f, 10) : lidOpen(f, 72);
    const lines = [md("$ ssh atlas"), md("ml@atlas:~/llm$ python train.py"), ...Array.from({ length: 30 }, (_, i) => epochLine(i + 1)), md("")];
    return (
        <AbsoluteFill>
            <Studio />
            <LaptopShot
                pose={f < 60 ? { pos: [-40, 28, 70], look: [0, 4.5, -3], fov: 24 } : { pos: [-40, 28, 70], look: [0, 4.5, -3], fov: 24 }}
                lid={lid}
                glow={Math.max(0, 1 - Math.max(0, (lid - 0.85) / 0.15))}
                screen={<PlainTerminal lines={lines} caret={1} />}
            />
        </AbsoluteFill>
    );
};
