// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/store/global";
import { useAtomValue } from "jotai";
import * as React from "react";
import { findOutputMatches, MaxOutputMatches, nextOutputMatchIndex } from "./output-inspector";
import type { TermViewModel } from "./term-model";

const IconButtonClass =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondary hover:bg-accent/20 hover:text-primary cursor-pointer disabled:opacity-35";

export function TermOutputInspector({ model }: { model: TermViewModel }) {
    const snapshot = useAtomValue(model.outputSnapshotAtom);
    const [query, setQuery] = React.useState("");
    const [matchIndex, setMatchIndex] = React.useState(-1);
    const [notice, setNotice] = React.useState("");
    const textRef = React.useRef<HTMLTextAreaElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);
    const deferredQuery = React.useDeferredValue(query);
    const matches = React.useMemo(
        () => findOutputMatches(snapshot?.text ?? "", deferredQuery),
        [snapshot, deferredQuery]
    );

    React.useEffect(() => {
        setQuery("");
        setNotice("");
        setMatchIndex(-1);
        if (snapshot) {
            searchRef.current?.focus();
        }
    }, [snapshot]);
    React.useEffect(() => setMatchIndex(-1), [deferredQuery]);

    const close = () => {
        globalStore.set(model.outputSnapshotAtom, null);
        if (globalStore.get(model.nodeModel.isFocused) && document.hasFocus()) {
            model.giveFocus();
        }
    };
    const selectMatch = (direction: 1 | -1, focusOutput = true) => {
        if (!matches.length || !textRef.current) {
            return;
        }
        const selected = nextOutputMatchIndex(matchIndex, matches.length, direction);
        const start = matches[selected];
        setMatchIndex(selected);
        if (focusOutput) {
            textRef.current.focus();
        }
        textRef.current.setSelectionRange(start, start + deferredQuery.length);
        const line = snapshot.text.slice(0, start).split("\n").length - 1;
        textRef.current.scrollTop = Math.max(0, line * 18 - textRef.current.clientHeight / 2);
    };

    if (!snapshot) {
        return null;
    }
    return (
        <section
            className="flex h-[45%] min-h-[150px] max-h-[420px] shrink-0 flex-col border-t border-border bg-[var(--app-bg-color)] text-primary"
            aria-label="Command output inspector"
            onContextMenu={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                    event.preventDefault();
                    close();
                }
            }}
        >
            <div className="flex items-center gap-2 px-3 pt-2">
                <i className="fa-solid fa-file-lines text-xs text-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={snapshot.command}>
                    {snapshot.command}
                </span>
                <button
                    className={IconButtonClass}
                    title="Go to original command"
                    aria-label="Go to original command"
                    onClick={() => {
                        const wrap = model.termRef.current;
                        if (wrap?.terminal.buffer.active.type === "alternate") {
                            setNotice("Exit the full-screen terminal program to view the original command.");
                            return;
                        }
                        const block = wrap?.cmdBlocks.find(
                            (item) =>
                                item.id === snapshot.commandid &&
                                item.startTs === snapshot.startts &&
                                item.command === snapshot.command
                        );
                        if (block?.startMarker?.line >= 0 && !block.startMarker.isDisposed) {
                            wrap.terminal.scrollToLine(block.startMarker.line);
                            close();
                        } else {
                            setNotice("Original output is no longer in the terminal buffer.");
                        }
                    }}
                >
                    <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                </button>
                <button
                    className={IconButtonClass}
                    title="Copy captured output"
                    aria-label="Copy captured output"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(snapshot.text);
                            setNotice("Copied captured output");
                        } catch {
                            setNotice("Could not copy. Select the output and use Copy.");
                        }
                    }}
                >
                    <i className="fa-regular fa-copy" aria-hidden="true" />
                </button>
                <button
                    className={IconButtonClass}
                    title="Close output (Esc)"
                    aria-label="Close output inspector"
                    onClick={close}
                >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
            </div>
            <div
                className="truncate px-3 pb-2 text-[10px] text-secondary"
                title={`${snapshot.connection} · ${snapshot.cwd}`}
            >
                {snapshot.connection === "local" ? "This computer" : snapshot.connection} · {snapshot.cwd} · Snapshot{" "}
                {new Date(snapshot.capturedat).toLocaleTimeString()}
                {snapshot.running
                    ? " · Command still running"
                    : snapshot.exitcode != null
                      ? ` · Exit ${snapshot.exitcode}`
                      : ""}
            </div>
            <div className="flex items-center gap-1 border-y border-border px-2 py-1">
                <input
                    ref={searchRef}
                    className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    aria-label="Find in captured output"
                    placeholder="Find in output…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                            event.preventDefault();
                            selectMatch(event.shiftKey ? -1 : 1, false);
                        }
                    }}
                />
                {query && (
                    <span className="whitespace-nowrap text-[10px] text-secondary">
                        {matches.length ? matchIndex + 1 : 0}/{matches.length}
                        {matches.length === MaxOutputMatches ? "+" : ""}
                    </span>
                )}
                <button
                    className={IconButtonClass}
                    aria-label="Previous output match"
                    title="Previous match"
                    disabled={!matches.length}
                    onClick={() => selectMatch(-1)}
                >
                    <i className="fa-solid fa-chevron-up" aria-hidden="true" />
                </button>
                <button
                    className={IconButtonClass}
                    aria-label="Next output match"
                    title="Next match"
                    disabled={!matches.length}
                    onClick={() => selectMatch(1)}
                >
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                </button>
            </div>
            <textarea
                ref={textRef}
                readOnly
                wrap="off"
                spellCheck={false}
                aria-label="Captured command output"
                className="min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 font-mono text-xs leading-[18px] text-primary outline-none"
                value={snapshot.text}
                placeholder="This command produced no captured output."
                onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                        event.preventDefault();
                        selectMatch(event.shiftKey ? -1 : 1);
                    }
                }}
            />
            {(snapshot.truncated || notice) && (
                <div className="border-t border-border px-3 py-1.5 text-[10px] text-secondary" role="status">
                    {notice ||
                        "Showing the end of the output (up to 2,000 rows / 256K characters). Earlier output was omitted."}
                </div>
            )}
        </section>
    );
}
