import { Easing, interpolate, spring } from "remotion";

// Curves named for what they do on screen. Camera moves use the long in-out; things that
// arrive use the expo-out landing.
export const Ease = {
    land: Easing.bezier(0.16, 1, 0.3, 1),
    reveal: Easing.bezier(0.22, 1, 0.36, 1),
    move: Easing.bezier(0.76, 0, 0.24, 1),
    // leaves at once and lands softly: for the pull-backs that follow an Enter
    whip: Easing.bezier(0.45, 0, 0.12, 1),
    glide: Easing.bezier(0.65, 0, 0.35, 1),
    exit: Easing.bezier(0.5, 0, 0.75, 0),
    linear: Easing.linear,
};

// Apple's spring parameterization (WWDC23): stiffness (2π/d)², damping 4π(1−bounce)/d, mass 1.
export function appleSpring(duration: number, bounce = 0) {
    return {
        mass: 1,
        stiffness: (2 * Math.PI / duration) ** 2,
        damping: (4 * Math.PI * (1 - bounce)) / duration,
        overshootClamping: false,
    };
}

export function springAt(frame: number, fps: number, duration: number, bounce = 0, delay = 0): number {
    return spring({ frame: frame - delay, fps, config: appleSpring(duration, bounce) });
}

export function ramp(
    frame: number,
    from: number,
    to: number,
    out: [number, number] = [0, 1],
    easing: (t: number) => number = Ease.glide
): number {
    if (to <= from) {
        return frame >= to ? out[1] : out[0];
    }
    return interpolate(frame, [from, to], out, {
        easing,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
}

export function mix(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// A smooth, seeded wobble for "never static" holds; amplitude in the caller's units.
export function drift(frame: number, seed: number, period = 420): number {
    const p = (frame / period) * Math.PI * 2;
    return Math.sin(p + seed * 1.7) * 0.6 + Math.sin(p * 0.53 + seed * 3.1) * 0.4;
}
