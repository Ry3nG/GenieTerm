// v3 structure, in bars of the 90 BPM score (one bar = 160 frames at 60 fps). Scene changes
// land on bar lines; everything inside a scene is timed in its own local frames.

export const BAR = 160;
export const BEAT = 40;

export const Scenes = {
    cold: [0, 4],
    title: [4, 6],
    connect: [6, 12],
    card1: [12, 13],
    durable: [13, 20],
    card2: [20, 21],
    host: [21, 27],
    card3: [27, 28],
    ai: [28, 37],
    outro: [37, 42],
} as const;

export type SceneName = keyof typeof Scenes;

export const sceneStart = (s: SceneName) => Scenes[s][0] * BAR;
export const sceneLength = (s: SceneName) => (Scenes[s][1] - Scenes[s][0]) * BAR;

export const TOTAL = Scenes.outro[1] * BAR;
