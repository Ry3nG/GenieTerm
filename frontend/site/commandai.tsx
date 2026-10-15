// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { makeProposalViews, type CommandAiSheetState } from "@/app/view/term/command-composer";
import { CommandAiSheet, type CommandAiSheetActions } from "@/app/view/term/command-composer-ui";
import { computeTheme } from "@/app/view/term/termutil";
import "@/app/view/term/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { DefaultFullConfig } from "../preview/mock/defaultconfig";
import { makeMockCommandAiStatus } from "../preview/previews/commandai.preview-util";

type Mode = "write" | "fix" | "explain";
const Ready = makeMockCommandAiStatus("claude");
const Base: CommandAiSheetState = {
    task: "compose",
    input: "Find all .log files in this project.",
    exchanges: [],
    selected: 0,
    includeOutput: true,
};
const Prompt = "\x1b[32mdemo@atlas\x1b[0m \x1b[34m~/project\x1b[0m $ ";
const Result: Record<Mode, Partial<CommandAiResult>> = {
    write: {
        proposals: [
            {
                command: "find . -type f -name '*.log'",
                explanation: "Finds log files in this folder and its subfolders.",
            },
        ],
    },
    fix: {
        summary: "The build needs Node.js type definitions.",
        proposals: [
            {
                command: "npm install --save-dev @types/node",
                explanation: "Installs the missing development dependency.",
            },
        ],
    },
    explain: {
        summary: "Shows the total disk space used by ./logs. The -s flag gives one total; -h makes the size readable.",
    },
};

export function CommandAiExperience() {
    const [mode, setMode] = useState<Mode>("write");
    const [sheet, setSheet] = useState<CommandAiSheetState>(Base);
    const [open, setOpen] = useState(true);
    const [output, setOutput] = useState(Prompt);
    const terminalElement = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal>(null);
    const terminalReady = useRef(false);
    const outputRef = useRef(output);
    outputRef.current = output;
    const requestVersion = useRef(0);
    const timer = useRef<ReturnType<typeof setTimeout>>(null);
    useEffect(() => {
        const [theme] = computeTheme(DefaultFullConfig, "default-dark", 0);
        const terminal = new Terminal({
            theme,
            fontFamily: "Hack",
            fontSize: 13,
            cursorBlink: false,
            disableStdin: true,
            allowTransparency: true,
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(terminalElement.current);
        terminalRef.current = terminal;
        let disposed = false;
        const resize = () => {
            if (!disposed) fit.fit();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(terminalElement.current);
        void document.fonts.ready.then(() => {
            if (!disposed) {
                fit.fit();
                terminalReady.current = true;
                terminal.write(outputRef.current);
            }
        });
        return () => {
            disposed = true;
            observer.disconnect();
            terminalRef.current = null;
            terminalReady.current = false;
            terminal.dispose();
            clearTimeout(timer.current);
        };
    }, []);
    useEffect(() => {
        if (!terminalReady.current) return;
        terminalRef.current?.reset();
        terminalRef.current?.write(output);
    }, [output]);
    useEffect(() => {
        const element = terminalElement.current?.closest(".site-ai");
        if (!element) return;
        const observer = new ResizeObserver(() => {
            window.parent.postMessage(
                { type: "genieterm:demo-height", height: Math.ceil(element.getBoundingClientRect().height + 16) },
                window.location.origin
            );
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const ask = (nextMode: Mode, state: CommandAiSheetState) => {
        clearTimeout(timer.current);
        const version = ++requestVersion.current;
        const prompt = state.input;
        setSheet({ ...state, input: "", pending: { requestId: String(version), prompt, startedAt: Date.now() } });
        timer.current = setTimeout(() => {
            if (requestVersion.current !== version) return;
            const result: CommandAiResult = {
                requestid: String(version),
                status: "ok",
                enginelabel: "Claude Code",
                ...Result[nextMode],
            };
            if (nextMode === "write" && /disk|space|size/i.test(prompt)) {
                result.proposals = [
                    { command: "du -sh ./*", explanation: "Shows the space used by each item in this folder." },
                ];
            }
            setSheet({
                ...state,
                input: "",
                pending: undefined,
                selected: 0,
                exchanges: [...state.exchanges, { prompt, result, proposals: makeProposalViews(result) }],
            });
        }, 650);
    };
    const chooseMode = (next: Mode) => {
        clearTimeout(timer.current);
        requestVersion.current++;
        setMode(next);
        setOpen(true);
        if (next === "write") {
            setSheet(Base);
            setOutput(Prompt);
            return;
        }
        const command = next === "fix" ? "npm run build" : "du -sh ./logs";
        const state: CommandAiSheetState = {
            ...Base,
            task: next,
            input: "",
            target: {
                blockId: 1,
                command,
                exitCode: next === "fix" ? 2 : 0,
                output: next === "fix" ? "error TS2688: Cannot find type definition file for 'node'." : "42M ./logs",
                outputLines: 1,
            },
        };
        setOutput(
            Prompt +
                command +
                "\r\n" +
                (next === "fix"
                    ? "\x1b[31merror TS2688: Cannot find type definition file for 'node'.\x1b[0m"
                    : "42M ./logs") +
                "\r\n\r\n" +
                Prompt
        );
        ask(next, state);
    };
    const actions: CommandAiSheetActions = {
        setInput: (input) => setSheet((s) => ({ ...s, input })),
        submit: () => ask(mode, sheet),
        cancel: () => {
            clearTimeout(timer.current);
            requestVersion.current++;
            setSheet((s) => ({ ...s, pending: undefined }));
        },
        close: () => setOpen(false),
        select: (selected) => setSheet((s) => ({ ...s, selected })),
        move: (delta) => {
            setSheet((s) => {
                const count = s.exchanges.at(-1)?.proposals.length || 1;
                return { ...s, selected: (s.selected + delta + count) % count };
            });
            return true;
        },
        apply: (id, action) => {
            const proposal = sheet.exchanges.at(-1)?.proposals.find((p) => p.id === id);
            if (!proposal) return;
            if (action === "copy") {
                void navigator.clipboard.writeText(proposal.command);
                setSheet((s) => ({ ...s, notice: "Copied" }));
                return;
            }
            setOutput(
                Prompt +
                    proposal.command +
                    (action === "run"
                        ? "\r\n" +
                          (mode === "fix" ? "added 2 packages" : "./logs/build.log\r\n./logs/server.log") +
                          "\r\n\r\n" +
                          Prompt
                        : "")
            );
            setOpen(false);
        },
        cancelConfirm: () => setSheet((s) => ({ ...s, confirmId: undefined })),
        retry: () => ask(mode, sheet),
        setIncludeOutput: (includeOutput) => setSheet((s) => ({ ...s, includeOutput })),
        toggleDisclosure: () =>
            setSheet((s) => ({
                ...s,
                disclosure: s.disclosure
                    ? undefined
                    : {
                          loading: false,
                          preview: {
                              destination: "Browser",
                              redactions: 0,
                              system: "",
                              message: s.input || s.target?.command || "",
                          },
                      },
            })),
        chooseEngine: () => {},
        openSettings: () => {},
        copyText: (text) => {
            void navigator.clipboard.writeText(text);
        },
    };
    return (
        <div className="site-ai">
            <div className="site-ai-tabs" role="group" aria-label="Command AI task">
                {(["write", "fix", "explain"] as const).map((task) => (
                    <button key={task} aria-pressed={mode === task} onClick={() => chooseMode(task)}>
                        {task === "write" ? "Write" : task === "fix" ? "Fix" : "Explain"}
                    </button>
                ))}
            </div>
            <div ref={terminalElement} className="site-ai-terminal" />
            {open ? (
                <CommandAiSheet
                    sheet={sheet}
                    status={Ready}
                    contextLabel="atlas · bash · ~/project"
                    isMac={true}
                    actions={actions}
                    autoFocus={false}
                    runBlockedReason={() => null}
                />
            ) : (
                <button className="site-ai-reset" onClick={() => chooseMode(mode)}>
                    Command AI
                </button>
            )}
        </div>
    );
}
