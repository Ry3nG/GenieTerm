import { Host, type Line, md, prompt } from "./ui";

// The film's training run, deterministic and self-consistent: the same epoch always shows the
// same loss wherever it appears (terminal, server card, TensorBoard chart).

export const EPOCHS = 100;

function noise(i: number): number {
    const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s) - 0.5;
}

export function lossAt(epoch: number): number {
    return 2.08 + 4.72 * Math.exp(-epoch / 19) + noise(epoch) * 0.03 * Math.exp(-epoch / 60);
}

const pad = (s: string | number, n: number) => String(s).padStart(n);

export function epochLine(e: number): Line {
    const loss = lossAt(e);
    return md(`epoch {w}${pad(e, 3)}{/}{d}/${EPOCHS}{/}   loss {w}${loss.toFixed(4)}{/}   ppl {d}${Math.exp(loss).toFixed(1).padStart(6)}{/}`);
}

export const trainHeader: Line = md("model {w}58M{/} params · {w}1× RTX 5090{/} · bf16 · {d}data/shards 0-63{/}");

// The terminal while training: the command, the header, and the latest `shown` epochs.
export function trainScreen(lastEpoch: number, rows = 14): Line[] {
    const first = Math.max(1, lastEpoch - rows + 1);
    const out: Line[] = [prompt("python train.py"), trainHeader];
    for (let e = first; e <= lastEpoch; e++) {
        out.push(epochLine(e));
    }
    return out;
}

export const sshBanner = (host = Host.name): Line[] => [
    md(`{d}Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-49-generic x86_64){/}`),
    md(`{d}Last login: Sat Oct 10 22:41:07 2026 from 10.0.0.12{/}`),
    prompt("", host),
];
