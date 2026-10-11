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

function typing(out: Cue[], start: number, text: string, per: number, db = 0) {
    for (let i = 0; i < text.length; i++) {
        if (text[i] === " " && i % 2) {
            continue;
        }
        out.push({ kind: "key", frame: Math.round(start + i * per + (i % 3) * 0.6), db: db + (text[i] === " " ? -2 : 0) });
    }
}

export function cuesV3(): Cue[] {
    const out: Cue[] = [];
    const at = (scene: Parameters<typeof sceneStart>[0], f: number) => sceneStart(scene) + f;

    // cold open: the lid, the night, the reopen
    out.push({ kind: "thump", frame: at("cold", ColdTimes.close + lidContact()), db: -4 });
    out.push({ kind: "open", frame: at("cold", ColdTimes.open + 4) });
    out.push({ kind: "whoosh", frame: at("cold", ColdTimes.push[1] - 30), dur: 1.2, db: -8 });

    // title: the name typed, the window rising
    typing(out, at("title", TitleTimes.type), "GenieTerm", 5, -9);
    out.push({ kind: "whoosh", frame: at("title", TitleTimes.rise[0] + 30), dur: 1.0, db: -10, up: false });

    // connect
    out.push({ kind: "click", frame: at("connect", C.chip) });
    out.push({ kind: "click", frame: at("connect", C.atlas) });
    out.push({ kind: "click", frame: at("connect", C.rail), db: -2 });
    out.push({ kind: "click", frame: at("connect", C.row), db: -3 });
    out.push({ kind: "click", frame: at("connect", C.row + 7), db: -4 });
    out.push({ kind: "click", frame: at("connect", C.lr + 6), db: -3 });
    out.push({ kind: "click", frame: at("connect", C.lr + 12), db: -4 });
    typing(out, at("connect", C.typeLr), "6e-4", 6);
    out.push({ kind: "click", frame: at("connect", C.save) });
    typing(out, at("connect", C.type), "python train.py", 5.2);
    out.push({ kind: "enter", frame: at("connect", C.enter) });

    // cards: the caret types softly
    for (const [scene, text] of [
        ["card1", "Close the lid. Keep training."],
        ["card2", "See the whole machine."],
        ["card3", "Stuck? Ask the AI you already use."],
    ] as const) {
        typing(out, at(scene, 12), text, 2.4, -12);
    }

    // durable: the same lid, then the server keeps counting through the quiet
    out.push({ kind: "thump", frame: at("durable", D.close + lidContact()), db: -4 });
    for (let f = D.count[0]; f < D.count[1]; f += 18) {
        out.push({ kind: "tick", frame: at("durable", f), db: -6 + (f > D.count[1] - 60 ? -4 : 0) });
    }
    out.push({ kind: "open", frame: at("durable", D.open + 4) });
    out.push({ kind: "chime", frame: at("durable", D.reconnected), db: -3 });
    out.push({ kind: "whoosh", frame: at("durable", D.push[1] - 30), dur: 1.2, db: -9 });

    // host and ports
    out.push({ kind: "click", frame: at("host", H.rail) });
    typing(out, at("host", H.type), "tensorboard --logdir runs", 3.3);
    out.push({ kind: "enter", frame: at("host", H.enter) });
    out.push({ kind: "click", frame: at("host", H.click) });
    out.push({ kind: "whoosh", frame: at("host", H.fly + 20), dur: 0.9, db: -8 });

    // command ai
    typing(out, at("ai", A.type1), "pip install flash-attn", 3.6);
    out.push({ kind: "enter", frame: at("ai", A.enter1) });
    out.push({ kind: "error", frame: at("ai", A.failed), db: -4 });
    out.push({ kind: "click", frame: at("ai", A.fix) });
    out.push({ kind: "click", frame: at("ai", A.pick) });
    out.push({ kind: "click", frame: at("ai", A.insert) });
    out.push({ kind: "enter", frame: at("ai", A.enter2) });
    out.push({ kind: "chime", frame: at("ai", A.done), db: -9 });
    typing(out, at("ai", A.type3), "show disk space left", 3.6);
    out.push({ kind: "enter", frame: at("ai", A.enter3) });

    return out.sort((a, b) => a.frame - b.frame);
}
