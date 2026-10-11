import { Easing, interpolate, spring } from "remotion";

// One source of truth for how things move. Two speeds, as in Apple's films: UI on short,
// nearly critically damped springs; the camera on long ease-outs. Nothing in a scene should
// carry its own magic easing numbers.

export const FPS = 60;
export const sec = (s: number) => Math.round(s * FPS);

export const Ease = {
    // things arriving: most of the distance early, then a long glide
    enter: Easing.bezier(0.05, 0.7, 0.1, 1),
    // things leaving: slow start, gone quickly
    exit: Easing.bezier(0.3, 0, 0.8, 0.15),
    // something already on screen moving to a new place
    move: Easing.bezier(0.2, 0, 0, 1),
    // camera arrivals: an expo-like ease-out with no snap
    camera: Easing.bezier(0.22, 1, 0.36, 1),
    // camera moves that start from rest
    glide: Easing.bezier(0.37, 0, 0.63, 1),
    out: Easing.bezier(0.23, 1, 0.32, 1),
    linear: Easing.linear,
};

export type SpringCfg = { mass: number; stiffness: number; damping: number; overshootClamping: boolean };

// Apple's parameterization (WWDC23): response in seconds, damping ratio ζ = 1 − bounce.
export function sp(response: number, zeta: number): SpringCfg {
    return {
        mass: 1,
        stiffness: ((2 * Math.PI) / response) ** 2,
        damping: (4 * Math.PI * zeta) / response,
        overshootClamping: false,
    };
}

// Bigger things bounce less: a 2% overshoot on a window is visible wobble, on a chip it is life.
export const Spring = {
    camera: sp(1.4, 1.0),
    large: sp(0.7, 0.92),
    medium: sp(0.5, 0.85),
    small: sp(0.35, 0.75),
    text: sp(0.6, 1.0),
    lid: sp(1.0, 0.86),
};

export function springAt(frame: number, start: number, cfg: SpringCfg): number {
    return spring({ frame: frame - start, fps: FPS, config: cfg });
}

export function ramp(frame: number, from: number, to: number, easing: (t: number) => number = Ease.move, out: [number, number] = [0, 1]): number {
    if (to <= from) {
        return frame >= to ? out[1] : out[0];
    }
    return interpolate(frame, [from, to], out, { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

// Additive keyframes: each new target adds a spring on top of the motion already in flight,
// so a value retargeted mid-move carries its velocity through instead of stopping dead.
export type Key = { at: number; v: number };
export function additive(frame: number, keys: Key[], cfg: SpringCfg): number {
    let acc = keys[0].v;
    for (let i = 1; i < keys.length; i++) {
        acc += (keys[i].v - keys[i - 1].v) * springAt(frame, keys[i].at, cfg);
    }
    return acc;
}

// Reading time for on-screen words: find it, then read at about 3.3 words a second.
export const holdFor = (words: number) => Math.max(sec(2), sec(1 + 0.3 * words));

// A seeded, slow wobble for "never dead" holds; amplitude in the caller's units.
export function drift(frame: number, seed: number, period = 480): number {
    const p = (frame / period) * Math.PI * 2;
    return Math.sin(p + seed * 1.7) * 0.6 + Math.sin(p * 0.53 + seed * 3.1) * 0.4;
}
