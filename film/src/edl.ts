// Edit decision list: when each scene starts and when each keystroke and click lands. The
// picture and the sound effects both read from here, so they cannot drift apart.
import { bar, BEAT, FPS } from "./timeline";
import { typeSchedule, type Typing } from "./lib/typing";

// Shift a humanized schedule so that Enter lands exactly on `enterAt`.
function typedTo(text: string, enterAt: number, seed: number, pace = 1): Typing {
    const draft = typeSchedule(text, 0, seed, FPS, pace);
    const shift = enterAt - draft.enter;
    return {
        text,
        start: draft.start + shift,
        chars: draft.chars.map((c) => c + shift),
        enter: enterAt,
    };
}

export const S1 = { from: 0, to: bar(4), typing: typedTo("genie ssh gpu-box", bar(2, 3), 11) };

export const S2 = { from: bar(4), to: bar(6), typing: typedTo("python train.py", BEAT * 3, 23) };

export const S3 = {
    from: bar(6),
    to: bar(9),
    lidClose: [30, 96] as const,
    lidOpen: [160, 222] as const,
    click: 240,
    // the missed output lands on the downbeat of bar 8
    burst: bar(8) - bar(6),
};

export const S4 = {
    from: bar(9),
    to: bar(13),
    typing: typedTo("nvidia-smi", BEAT * 2, 31),
    click: bar(11) - bar(9),
};

export const S5 = {
    from: bar(13),
    to: bar(16),
    typing: typedTo("tensorboard --logdir runs", BEAT * 3.5, 47),
    offer: bar(14, 2) - bar(13),
    click: bar(15) - bar(13),
};

export const S6 = {
    from: bar(16),
    to: bar(18),
    typing: typedTo("genie view .", BEAT * 2, 53),
    open: BEAT * 5,
};

export const S7 = {
    from: bar(18),
    to: bar(22),
    typing: typedTo("pip install flash-attn", BEAT * 2.75, 61),
    failed: bar(19) - bar(18),
    ask: bar(19, 3) - bar(18),
    answer: bar(20) - bar(18),
    insert: bar(20, 2) - bar(18),
    run: bar(20, 3) - bar(18),
    fixed: bar(21, 2) - bar(18),
};

export const S8 = { from: bar(22), to: bar(23), typing: typedTo("exit", bar(22, 2) - bar(22), 71, 1.15) };

export const LOGO = bar(23);

export type Cue = { kind: string; frame: number; db?: number; pan?: number; dur?: number; up?: boolean };

function keyCues(typing: Typing, offset: number): Cue[] {
    const out: Cue[] = typing.chars.map((c, i) => ({
        kind: "key",
        frame: offset + c,
        pan: ((i % 7) - 3) * 0.04,
        db: typing.text[i] === " " ? 1 : 0,
    }));
    out.push({ kind: "enter", frame: offset + typing.enter });
    return out;
}

export function cues(): Cue[] {
    return [
        ...keyCues(S1.typing, S1.from),
        { kind: "whoosh", frame: S1.from + S1.typing.enter + 22, dur: 0.75, up: false },
        ...keyCues(S2.typing, S2.from),
        { kind: "thump", frame: S3.from + S3.lidClose[1] },
        { kind: "click", frame: S3.from + S3.click },
        ...keyCues(S4.typing, S4.from),
        { kind: "click", frame: S4.from + S4.click },
        { kind: "whoosh", frame: S4.from + S4.click + 60, dur: 0.6 },
        ...keyCues(S5.typing, S5.from),
        { kind: "click", frame: S5.from + S5.click },
        ...keyCues(S6.typing, S6.from),
        { kind: "click", frame: S6.from + S6.open, db: -2 },
        { kind: "click", frame: S6.from + S6.open + 7, db: -3 },
        ...keyCues(S7.typing, S7.from),
        { kind: "click", frame: S7.from + S7.ask },
        { kind: "click", frame: S7.from + S7.insert },
        { kind: "enter", frame: S7.from + S7.run },
        { kind: "chime", frame: S7.from + S7.fixed },
        ...keyCues(S8.typing, S8.from),
    ];
}
