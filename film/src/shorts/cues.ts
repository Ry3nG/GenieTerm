import { lidContact } from "../kit/laptopshot";
import { aiCues, cardCues, hostCues, typing, type Cue } from "../v3/cues";
import { A } from "../v3/Ai";
import { H } from "../v3/HostPorts";
import { G } from "./AgentAway";
import { F } from "./FilesShort";
import { REQUEST } from "./agent";
import { HOOK, type ShortSpec } from "./ShortFilm";

// Sound for each short: its cues, and the few musical facts the score needs (when the room
// goes quiet, when things bloom, when something fails or lands), all in frames.

export type Music = { quiet: [number, number][]; blooms: number[]; dark: number[]; bright: number[]; end: number };

export const agentCues = (out: Cue[], at: (f: number) => number) => {
    typing(out, at(G.type), REQUEST, 1.55, -2);
    out.push({ kind: "enter", frame: at(G.submit) });
    out.push({ kind: "whoosh", frame: at(G.handoff + 30), dur: 1.1, db: -10, up: false });
    out.push({ kind: "thump", frame: at(G.close + lidContact()), db: -4 });
    for (const f of [G.night[0], G.night[0] + 48, G.night[0] + 96, G.night[0] + 144, G.night[0] + 192, G.night[1]]) {
        out.push({ kind: "tick", frame: at(f), db: -5 });
    }
    out.push({ kind: "open", frame: at(G.open + 4) });
    out.push({ kind: "chime", frame: at(G.reconnected), db: -3 });
    out.push({ kind: "whoosh", frame: at(G.push[1] - 30), dur: 1.2, db: -9 });
};

export const filesCues = (out: Cue[], at: (f: number) => number) => {
    out.push({ kind: "click", frame: at(F.pick) });
    out.push({ kind: "whoosh", frame: at(F.drop - 20), dur: 0.7, db: -14 });
    out.push({ kind: "click", frame: at(F.drop), db: -2 });
    out.push({ kind: "chime", frame: at(F.upload[1]), db: -10 });
    out.push({ kind: "click", frame: at(F.dbl), db: -3 });
    out.push({ kind: "click", frame: at(F.dbl + 7), db: -4 });
    out.push({ kind: "click", frame: at(F.select), db: -3 });
    out.push({ kind: "click", frame: at(F.select + 6), db: -4 });
    typing(out, at(F.type), "6e-4", 6);
    out.push({ kind: "click", frame: at(F.save) });
};

export function shortSound(spec: ShortSpec): { cues: Cue[]; music: Music } {
    const out: Cue[] = [];
    const at = (f: number) => HOOK + f;
    cardCues(out, (f) => f, spec.hook);
    const end = HOOK + spec.demoLength;
    let music: Music = { quiet: [], blooms: [], dark: [], bright: [], end };
    if (spec.id === "ShortAgent") {
        agentCues(out, at);
        music = { quiet: [[at(G.close + lidContact()), at(G.reconnected)]], blooms: [at(G.reconnected)], dark: [], bright: [at(G.label)], end };
    } else if (spec.id === "ShortAI") {
        aiCues(out, at);
        music = { quiet: [], blooms: [], dark: [at(A.failed)], bright: [at(A.done)], end };
    } else if (spec.id === "ShortFiles") {
        filesCues(out, at);
        music = { quiet: [], blooms: [], dark: [], bright: [at(F.upload[1])], end };
    } else if (spec.id === "ShortHost") {
        hostCues(out, at);
        music = { quiet: [], blooms: [at(H.fly)], dark: [], bright: [], end };
    }
    return { cues: out.sort((a, b) => a.frame - b.frame), music };
}

// The overview: title typing, each card, and each excerpt's own cues, trimmed to its window.
export function overviewSound(layout: { parts: { id: string; hook: string; card: number; clip: number; from: number; length: number }[]; end: number }) {
    const out: Cue[] = [];
    typing(out, 24, "GenieTerm", 5, -9);
    const music: Music = { quiet: [], blooms: [], dark: [], bright: [], end: layout.end };
    const builders: Record<string, (o: Cue[], at: (f: number) => number) => void> = { agent: agentCues, files: filesCues, host: hostCues, ai: aiCues };
    for (const p of layout.parts) {
        cardCues(out, (f) => p.card + f, p.hook);
        const at = (f: number) => p.clip + f - p.from;
        const mine: Cue[] = [];
        builders[p.id](mine, at);
        out.push(...mine.filter((c) => c.frame >= p.clip + 6 && c.frame < p.clip + p.length - 6));
        if (p.id === "agent") {
            music.quiet.push([at(G.close + lidContact()), at(G.reconnected)]);
            music.blooms.push(at(G.reconnected));
        } else if (p.id === "files") {
            music.bright.push(at(F.upload[1]));
        } else if (p.id === "host") {
            music.blooms.push(at(H.fly));
        } else if (p.id === "ai") {
            music.dark.push(at(A.failed));
            music.bright.push(at(A.done));
        }
    }
    return { cues: out.sort((a, b) => a.frame - b.frame), music };
}
