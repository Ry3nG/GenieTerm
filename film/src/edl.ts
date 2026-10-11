// Edit decision list: when each chapter's beats happen, in frames from the chapter's start.
// The picture and the sound effects both read from here, so they cannot drift apart.
import { Chapters, FPS } from "./timeline";
import { typeSchedule, type Typing } from "./lib/typing";

// Shift a humanized schedule so that Enter lands exactly on `enterAt`.
function typedTo(text: string, enterAt: number, seed: number, pace = 1): Typing {
    const draft = typeSchedule(text, 0, seed, FPS, pace);
    const shift = enterAt - draft.enter;
    return { text, start: draft.start + shift, chars: draft.chars.map((c) => c + shift), enter: enterAt };
}

// Every chapter opens on its title: the UI steps back while the words come in, then returns.
export const TITLE_IN = 14;
export const TITLE_OUT = 128;
export const UI_FORWARD = 170;

export const Connect = { ...Chapters.connect, click: 250, pick: 360, callout: 430 };

export const Durable = {
    ...Chapters.durable,
    typing: typedTo("python train.py", 262, 23),
    streamEnd: 430,
    toDiagram: [430, 482] as const,
    lidClose: [572, 626] as const,
    serverOnly: [626, 790] as const,
    lidOpen: [790, 846] as const,
    dive: [846, 902] as const,
    click: 962,
    burst: 1000,
    callout: 1030,
};

export const Host = { ...Chapters.host, click: 240, gpu: 340, lift: 360, callout: 440 };

export const Ports = {
    ...Chapters.ports,
    typing: typedTo("tensorboard --logdir runs", 282, 47, 0.82),
    url: 340,
    offer: 382,
    click: 472,
    callout: 520,
};

export const Files = { ...Chapters.files, click: 220, open: 350, callout: 400 };

export const Ai = {
    ...Chapters.ai,
    typing: typedTo("pip install flash-attn", 272, 61, 0.9),
    failed: 330,
    ask: 440,
    answer: 520,
    insert: 600,
    run: 632,
    fixed: 702,
};

export const Outro = { ...Chapters.outro, card: 220 };

export type Cue = { kind: string; frame: number; db?: number; pan?: number; dur?: number; up?: boolean };

function keyCues(typing: Typing, offset: number): Cue[] {
    const out: Cue[] = typing.chars.map((c, i) => ({
        kind: "key",
        frame: offset + c,
        pan: ((i % 7) - 3) * 0.04,
        db: typing.text[i] === " " ? 0 : -1.5,
    }));
    out.push({ kind: "enter", frame: offset + typing.enter, db: -1 });
    return out;
}

export function cues(): Cue[] {
    return [
        { kind: "click", frame: Connect.from + Connect.click, db: -3 },
        { kind: "click", frame: Connect.from + Connect.pick, db: -3 },
        ...keyCues(Durable.typing, Durable.from),
        { kind: "whoosh", frame: Durable.from + Durable.toDiagram[1] - 8, dur: 0.9, up: false, db: -6 },
        { kind: "thump", frame: Durable.from + Durable.lidClose[1] - 4, db: -4 },
        { kind: "whoosh", frame: Durable.from + Durable.dive[1] - 6, dur: 0.8, db: -6 },
        { kind: "click", frame: Durable.from + Durable.click, db: -3 },
        { kind: "click", frame: Host.from + Host.click, db: -3 },
        ...keyCues(Ports.typing, Ports.from),
        { kind: "click", frame: Ports.from + Ports.click, db: -3 },
        { kind: "click", frame: Files.from + Files.click, db: -3 },
        { kind: "click", frame: Files.from + Files.open, db: -4 },
        { kind: "click", frame: Files.from + Files.open + 7, db: -5 },
        ...keyCues(Ai.typing, Ai.from),
        { kind: "click", frame: Ai.from + Ai.ask, db: -3 },
        { kind: "click", frame: Ai.from + Ai.insert, db: -3 },
        { kind: "enter", frame: Ai.from + Ai.run, db: -1 },
        { kind: "chime", frame: Ai.from + Ai.fixed, db: -2 },
    ];
}
