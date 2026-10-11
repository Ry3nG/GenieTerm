import { A } from "./Ai";
import { C } from "./Connect";
import { ColdTimes } from "./ColdOpen";
import { D } from "./Durable";
import { H } from "./HostPorts";
import { TitleTimes } from "./Title";
import { sceneStart } from "./timeline";
import { lidContact } from "../kit/laptopshot";

// Every sound the picture implies, at the frame it happens, for audio/sfx.py. Built from the
// same constants the scenes animate with, so retiming a scene retimes its sound.

export type Cue = { kind: string; frame: number; db?: number; pan?: number; dur?: number; up?: boolean };

export function typing(out: Cue[], start: number, text: string, per: number, db = 0) {
    for (let i = 0; i < text.length; i++) {
        if (text[i] === " " && i % 2) {
            continue;
        }
        out.push({ kind: "key", frame: Math.round(start + i * per + (i % 3) * 0.6), db: db + (text[i] === " " ? -2 : 0) });
    }
}

type At = (f: number) => number;

export const coldCues = (out: Cue[], at: At) => {
    out.push({ kind: "thump", frame: at(ColdTimes.close + lidContact()), db: -4 });
    out.push({ kind: "open", frame: at(ColdTimes.open + 4) });
    out.push({ kind: "whoosh", frame: at(ColdTimes.push[1] - 30), dur: 1.2, db: -8 });
};

export const titleCues = (out: Cue[], at: At) => {
    typing(out, at(TitleTimes.type), "GenieTerm", 5, -9);
    out.push({ kind: "whoosh", frame: at(TitleTimes.rise[0] + 30), dur: 1.0, db: -10, up: false });
};

export const connectCues = (out: Cue[], at: At) => {
    out.push({ kind: "click", frame: at(C.chip) });
    out.push({ kind: "click", frame: at(C.atlas) });
    out.push({ kind: "click", frame: at(C.rail), db: -2 });
    out.push({ kind: "click", frame: at(C.row), db: -3 });
    out.push({ kind: "click", frame: at(C.row + 7), db: -4 });
    out.push({ kind: "click", frame: at(C.lr + 6), db: -3 });
    out.push({ kind: "click", frame: at(C.lr + 12), db: -4 });
    typing(out, at(C.typeLr), "6e-4", 6);
    out.push({ kind: "click", frame: at(C.save) });
    typing(out, at(C.type), "python train.py", 5.2);
    out.push({ kind: "enter", frame: at(C.enter) });
};

// the card's caret types softly
export const cardCues = (out: Cue[], at: At, text: string) => typing(out, at(12), text, 2.4, -12);

export const durableCues = (out: Cue[], at: At) => {
    out.push({ kind: "thump", frame: at(D.close + lidContact()), db: -4 });
    for (let f = D.count[0]; f < D.count[1]; f += 18) {
        out.push({ kind: "tick", frame: at(f), db: -6 + (f > D.count[1] - 60 ? -4 : 0) });
    }
    out.push({ kind: "open", frame: at(D.open + 4) });
    out.push({ kind: "chime", frame: at(D.reconnected), db: -3 });
    out.push({ kind: "whoosh", frame: at(D.push[1] - 30), dur: 1.2, db: -9 });
};

export const hostCues = (out: Cue[], at: At) => {
    out.push({ kind: "click", frame: at(H.rail) });
    typing(out, at(H.type), "tensorboard --logdir runs", 3.3);
    out.push({ kind: "enter", frame: at(H.enter) });
    out.push({ kind: "click", frame: at(H.click) });
    out.push({ kind: "whoosh", frame: at(H.fly + 20), dur: 0.9, db: -8 });
};

export const aiCues = (out: Cue[], at: At) => {
    typing(out, at(A.type1), "pip install flash-attn", 3.6);
    out.push({ kind: "enter", frame: at(A.enter1) });
    out.push({ kind: "error", frame: at(A.failed), db: -4 });
    out.push({ kind: "click", frame: at(A.fix) });
    out.push({ kind: "click", frame: at(A.pick) });
    out.push({ kind: "click", frame: at(A.insert) });
    out.push({ kind: "enter", frame: at(A.enter2) });
    out.push({ kind: "chime", frame: at(A.done), db: -9 });
    typing(out, at(A.type3), "show disk space left", 3.6);
    out.push({ kind: "enter", frame: at(A.enter3) });
};

export function cuesV3(): Cue[] {
    const out: Cue[] = [];
    const at = (scene: Parameters<typeof sceneStart>[0]) => (f: number) => sceneStart(scene) + f;
    coldCues(out, at("cold"));
    titleCues(out, at("title"));
    connectCues(out, at("connect"));
    cardCues(out, at("card1"), "Close the lid. Keep training.");
    cardCues(out, at("card2"), "See the whole machine.");
    cardCues(out, at("card3"), "Stuck? Ask the AI you already use.");
    durableCues(out, at("durable"));
    hostCues(out, at("host"));
    aiCues(out, at("ai"));
    return out.sort((a, b) => a.frame - b.frame);
}
