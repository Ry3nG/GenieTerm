import type { CaptureScene } from "../captures.generated";
import { indexAtTime } from "./frames";
import { typedCount, type Typing } from "./typing";

// [film frame (scene-local), capture time in ms] pairs; straight lines in between. A
// steeper segment is a time-lapse of real footage, never invented frames.
export type TimeMap = [number, number][];

export function mapTime(map: TimeMap, f: number): number {
    if (f <= map[0][0]) {
        return map[0][1];
    }
    for (let i = 1; i < map.length; i++) {
        const [f0, t0] = map[i - 1];
        const [f1, t1] = map[i];
        if (f <= f1) {
            return t0 + ((t1 - t0) * (f - f0)) / (f1 - f0);
        }
    }
    return map[map.length - 1][1];
}

export function firstKeyIndex(s: CaptureScene): number {
    return s.frames.findIndex((fr) => fr.label.startsWith("key:"));
}

export function frameT(s: CaptureScene, idx: number): number {
    return s.frames[Math.max(0, Math.min(s.frames.length - 1, idx))].t;
}

// Which capture to show at scene-local frame f.
export function clipIndex(s: CaptureScene, f: number, typing: Typing | null, map: TimeMap | null): number {
    if (typing && f < typing.enter) {
        const n = typedCount(typing, f);
        if (n === 0) {
            return Math.max(0, firstKeyIndex(s) - 1);
        }
        return firstKeyIndex(s) + n - 1;
    }
    if (!map) {
        return s.frames.length - 1;
    }
    return indexAtTime(s, mapTime(map, f));
}
