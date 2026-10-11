// The film runs on the score's grid: 90 BPM at 60 fps is exactly 40 frames a beat and
// 160 frames a bar, so chapter changes and the moments that matter can land on the music.
export const FPS = 60;
export const BPM = 90;
export const BEAT = 40;
export const BAR = 160;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export function bar(n: number, beat = 0): number {
    return Math.round((n - 1) * BAR + beat * BEAT);
}

// One training run, start to finish: connect, open the project, start it and walk away, come
// back to a busy GPU and a loss curve, then make it faster. In bars; audio/score.py follows.
export const Chapters = {
    intro: { from: bar(1), to: bar(3) },
    connect: { from: bar(3), to: bar(7) },
    files: { from: bar(7), to: bar(10) },
    durable: { from: bar(10), to: bar(17) },
    host: { from: bar(17), to: bar(21) },
    ports: { from: bar(21), to: bar(25) },
    ai: { from: bar(25), to: bar(30) },
    outro: { from: bar(30), to: bar(33) },
} as const;

export const TOTAL_BARS = 32;
export const DURATION = bar(TOTAL_BARS + 1) + Math.round(FPS * 2.5);
