import React from "react";
import { CaptureWindow, scene } from "../lib/frames";
import { GpuCard, SidebarGpuPatch } from "../lib/gpucard";

// The hero layout's Host pane carries the shared GPU's real load; the film's own run is drawn
// over it so every number on screen tells the same story.
const HeroGpu = { x: 1026.5, y: 172.5 };

export const HeroWindow: React.FC<{ idx: number; f: number; glow: number }> = ({ idx, f, glow }) => (
    <>
        <CaptureWindow scene={scene("c_hero")} index={idx} glow={glow} />
        <GpuCard x={HeroGpu.x} y={HeroGpu.y} build={1} frame={f} />
        <SidebarGpuPatch />
    </>
);
