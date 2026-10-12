// Humanized typing: the same schedule drives the picture (which capture to show) and the
// keystroke sounds, so they can never drift apart.

export function prng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gauss(rand: () => number) {
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const FastWords = ["ssh", "pip", "git", "cd", "ls", "exit", "genie", "python"];

export type Typing = {
    text: string;
    start: number;
    // frame at which character i appears
    chars: number[];
    enter: number;
};

export function typeSchedule(text: string, start: number, seed: number, fps = 60, pace = 1): Typing {
    const rand = prng(seed);
    const chars: number[] = [];
    let t = 0;
    let word = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const prev = text[i - 1];
        let ms = 72 + gauss(rand) * 16;
        if (FastWords.some((w) => w.startsWith(word + ch)) && word.length > 0) {
            ms -= 22;
        }
        if (prev === " ") {
            ms += 90 + rand() * 110;
            if (ch === "-") {
                ms += 60;
            }
        }
        if (ch === " ") {
            word = "";
        } else {
            word += ch;
        }
        t += i === 0 ? 0 : Math.max(38, ms) * pace;
        chars.push(start + Math.round((t / 1000) * fps));
    }
    const enter = chars[chars.length - 1] + Math.round(((380 + rand() * 160) / 1000) * fps * pace);
    return { text, start, chars, enter };
}

export function typedCount(typing: Typing, frame: number): number {
    let n = 0;
    for (const f of typing.chars) {
        if (frame >= f) {
            n++;
        }
    }
    return n;
}
