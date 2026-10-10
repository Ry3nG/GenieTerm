// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type GitChip = { label: string; title: string; dirty: boolean };

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function makeGitChip(status: GitStatusResponse): GitChip {
    if (status == null || status.exitcode !== 0 || !status.supported) {
        return null;
    }
    const name = status.detached ? "detached HEAD" : status.branch;
    if (!name) {
        return null;
    }
    const changed = status.files?.length ?? 0;
    let label = name;
    if (status.ahead > 0) {
        label += ` ↑${status.ahead}`;
    }
    if (status.behind > 0) {
        label += ` ↓${status.behind}`;
    }
    const parts = [status.detached ? "Detached HEAD" : `Branch ${name}`];
    if (status.upstream) {
        if (status.ahead > 0 || status.behind > 0) {
            const sync = [
                status.ahead > 0 ? `${status.ahead} ahead` : "",
                status.behind > 0 ? `${status.behind} behind` : "",
            ]
                .filter(Boolean)
                .join(", ");
            parts.push(`${sync} ${status.upstream}`);
        } else {
            parts.push(`up to date with ${status.upstream}`);
        }
    }
    parts.push(changed > 0 ? plural(changed, "changed file") : "no changes");
    return { label, title: parts.join(" · "), dirty: changed > 0 };
}
