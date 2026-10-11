// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { makeProposalViews, type CommandAiSheetState } from "@/app/view/term/command-composer";
import { CommandAiSheet, type CommandAiSheetActions } from "@/app/view/term/command-composer-ui";
import * as React from "react";
import { makeMockCommandAiStatus } from "./commandai.preview-util";

const Now = 1_000_000;
const ReadyStatus = makeMockCommandAiStatus("claude");
const SetupStatus = makeMockCommandAiStatus("");

function exchange(prompt: string, result: Partial<CommandAiResult>) {
    const full: CommandAiResult = { requestid: "r", status: "ok", enginelabel: "Claude Code", ...result };
    return { prompt, result: full, proposals: makeProposalViews(full) };
}

const Compose = exchange("find files larger than 100 MB here", {
    proposals: [
        {
            command: "find . -type f -size +100M -exec ls -lh {} + 2>/dev/null",
            explanation: "Lists files over 100 MB in this folder and below, with their sizes.",
        },
        {
            command: "find . -type f -size +100M -print0 | xargs -0 du -h | sort -rh",
            explanation: "Same search, sorted from largest to smallest.",
        },
        {
            command: "find . -type f -size +100M -delete",
            explanation: "Deletes every file over 100 MB here and below. Only use this if you're sure.",
        },
    ],
});

const Fix = exchange("", {
    summary:
        "The build failed because `tsc` can't find the type definitions for `node`. They aren't installed in this project yet.",
    proposals: [
        {
            command: "npm install --save-dev @types/node",
            explanation: "Installs the missing Node.js type definitions.",
        },
        {
            command: "npm ci && npm run build",
            explanation: "Reinstalls dependencies from the lockfile, then builds again.",
        },
    ],
});

const Explain = exchange("", {
    summary:
        "Extracts a gzip-compressed tar archive into the current folder.\n\n• `-x` extracts, `-z` decompresses with gzip, `-v` lists each file, and `-f` names the archive.\n• Files with the same names are overwritten without asking.",
});

const Base: CommandAiSheetState = {
    task: "compose",
    input: "",
    exchanges: [],
    selected: 0,
    includeOutput: true,
};

type Case = { name: string; sheet: CommandAiSheetState; status?: CommandAiStatus; context?: string };

const Cases: Case[] = [
    { name: "First use", sheet: Base, status: SetupStatus },
    { name: "Compose", sheet: { ...Base, input: "" } },
    {
        name: "Asking",
        sheet: {
            ...Base,
            pending: { requestId: "p", prompt: "find files larger than 100 MB here", startedAt: Now - 4200 },
        },
    },
    { name: "Proposals", sheet: { ...Base, exchanges: [Compose] } },
    {
        name: "Confirm before running",
        sheet: { ...Base, exchanges: [Compose], selected: 2, confirmId: Compose.proposals[2].id },
    },
    {
        name: "Refined",
        sheet: {
            ...Base,
            exchanges: [
                Compose,
                exchange("only in src, sort by size", {
                    proposals: [
                        {
                            command: "find src -type f -size +100M -print0 | xargs -0 du -h | sort -rh",
                            explanation: "Searches only src and sorts the matches by size.",
                        },
                    ],
                }),
            ],
            notice: "Copied",
        },
    },
    {
        name: "Fix",
        sheet: {
            ...Base,
            task: "fix",
            target: { blockId: 3, command: "npm run build", exitCode: 2, output: "…", outputLines: 42 },
            exchanges: [Fix],
        },
        context: "build-01 · bash · ~/app",
    },
    {
        name: "Explain",
        sheet: {
            ...Base,
            task: "explain",
            target: { blockId: 4, command: "tar -xzvf release.tar.gz", exitCode: 0 },
            exchanges: [Explain],
        },
    },
    {
        name: "Signed out",
        sheet: {
            ...Base,
            exchanges: [
                exchange("list docker containers", {
                    status: "signedout",
                    enginelabel: "Codex",
                    fixcommand: "codex login",
                    statusdetail: "Codex needs you to sign in before it can answer.",
                }),
            ],
        },
    },
    {
        name: "What’s sent",
        sheet: {
            ...Base,
            input: "find files larger than 100 MB here",
            disclosure: {
                loading: false,
                preview: {
                    destination: "Claude Code on this computer, using your Claude sign-in",
                    redactions: 1,
                    system: "You are Command AI in GenieTerm, a terminal app. …",
                    message:
                        "<environment>\nLocation: Remote host over SSH\nOperating system: Ubuntu 22.04.4 LTS (Linux 5.15.0 x86_64)\nShell: bash 5.1.16\nWorking directory: ~/app\n</environment>\n\n<recent_commands>\nexport API_TOKEN=[REDACTED]\nls -la\n</recent_commands>\n\nRequest: find files larger than 100 MB here",
                },
            },
        },
    },
];

const NoopActions: CommandAiSheetActions = {
    setInput: () => {},
    submit: () => {},
    cancel: () => {},
    close: () => {},
    select: () => {},
    move: () => false,
    apply: () => {},
    cancelConfirm: () => {},
    retry: () => {},
    setIncludeOutput: () => {},
    toggleDisclosure: () => {},
    chooseEngine: () => {},
    openSettings: () => {},
    copyText: () => {},
};

function FakeTerminal({ children, width }: { children: React.ReactNode; width: number }) {
    return (
        <div
            className="relative flex h-[440px] shrink-0 flex-col justify-start overflow-hidden rounded-lg border border-border bg-[#1a1a1c] p-3 font-mono text-[12px] leading-5 text-secondary"
            style={{ width }}
        >
            <div>
                <span className="text-success">~/app</span> <span className="text-muted">$</span> npm run build
            </div>
            <div className="text-error">error TS2688: Cannot find type definition file for 'node'.</div>
            <div>
                <span className="text-success">~/app</span> <span className="text-muted">$</span>
            </div>
            <div className="absolute inset-3 flex items-end">
                <div className="flex max-h-full w-full flex-col">{children}</div>
            </div>
        </div>
    );
}

function InteractiveSheet() {
    const [sheet, setSheet] = React.useState<CommandAiSheetState>(Base);
    const timer = React.useRef<number>(null);
    const actions: CommandAiSheetActions = {
        ...NoopActions,
        setInput: (input) => setSheet((s) => ({ ...s, input })),
        submit: () => {
            setSheet((s) => ({
                ...s,
                input: "",
                pending: { requestId: "p", prompt: s.input || "fix", startedAt: Date.now() },
            }));
            timer.current = window.setTimeout(() => {
                setSheet((s) => ({
                    ...s,
                    pending: undefined,
                    exchanges: [...s.exchanges, { ...Compose, prompt: s.pending?.prompt ?? "" }],
                    selected: 0,
                }));
            }, 1800);
        },
        cancel: () => {
            window.clearTimeout(timer.current);
            setSheet((s) => ({ ...s, input: s.pending?.prompt ?? "", pending: undefined }));
        },
        close: () => setSheet(Base),
        select: (selected) => setSheet((s) => ({ ...s, selected, confirmId: undefined })),
        move: (delta) => {
            setSheet((s) => {
                const count = s.exchanges[s.exchanges.length - 1]?.proposals.length ?? 0;
                return count === 0 ? s : { ...s, selected: (s.selected + delta + count) % count, confirmId: undefined };
            });
            return true;
        },
        apply: (id, action) =>
            setSheet((s) => {
                const proposal = s.exchanges[s.exchanges.length - 1]?.proposals.find((p) => p.id === id);
                if (action === "run" && proposal?.risk.level === "danger" && s.confirmId !== id) {
                    return { ...s, confirmId: id };
                }
                return {
                    ...s,
                    confirmId: undefined,
                    notice: action === "copy" ? "Copied" : `Would ${action}: ${proposal?.command}`,
                };
            }),
        cancelConfirm: () => setSheet((s) => ({ ...s, confirmId: undefined })),
        toggleDisclosure: () =>
            setSheet((s) => ({
                ...s,
                disclosure: s.disclosure ? undefined : { loading: false, preview: Cases[9].sheet.disclosure.preview },
            })),
    };
    return (
        <CommandAiSheet
            sheet={sheet}
            status={ReadyStatus}
            contextLabel="This computer · zsh · ~/app"
            isMac={true}
            runBlockedReason={() => null}
            actions={actions}
            autoFocus={false}
        />
    );
}

export function CommandAiPreview() {
    const [width, setWidth] = React.useState(760);
    return (
        <div className="flex w-full flex-col gap-5 p-4">
            <div className="flex items-center gap-4">
                <h1 className="text-sm text-primary">Command AI sheet</h1>
                <label className="flex items-center gap-2 text-xs text-secondary">
                    Terminal width
                    <input
                        type="range"
                        min={340}
                        max={1000}
                        value={width}
                        onChange={(e) => setWidth(Number(e.target.value))}
                        className="cursor-pointer"
                    />
                    <span className="tabular-nums">{width}px</span>
                </label>
            </div>
            <section className="space-y-2">
                <h2 className="text-xs font-semibold text-secondary">Interactive</h2>
                <FakeTerminal width={width}>
                    <InteractiveSheet />
                </FakeTerminal>
            </section>
            <div className="flex flex-wrap gap-5">
                {Cases.map((c) => (
                    <section key={c.name} className="space-y-2" data-case={c.name}>
                        <h2 className="text-xs font-semibold text-secondary">{c.name}</h2>
                        <FakeTerminal width={width}>
                            <CommandAiSheet
                                sheet={c.sheet}
                                status={c.status ?? ReadyStatus}
                                contextLabel={c.context ?? "This computer · zsh · ~/app"}
                                isMac={true}
                                runBlockedReason={() => null}
                                actions={NoopActions}
                                now={Now}
                                autoFocus={false}
                            />
                        </FakeTerminal>
                    </section>
                ))}
            </div>
        </div>
    );
}
