// The film runs on the score's grid: 100 BPM at 60 fps is exactly 36 frames a beat and
// 144 frames a bar, so every cut and every keystroke can land on the music.
export const FPS = 60;
export const BPM = 100;
export const BEAT = 36;
export const BAR = 144;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export function bar(n: number, beat = 0): number {
    return Math.round((n - 1) * BAR + beat * BEAT);
}

// 24 bars of picture, then the score's 3.5 s tail under the end card
export const TOTAL_BARS = 24;
export const DURATION = bar(TOTAL_BARS + 1) + Math.round(FPS * 3.5);

// The logo lands on bar 23; audio/score.py follows the same plan.
export const Sections = {
    logo: { from: bar(23), to: DURATION },
} as const;
