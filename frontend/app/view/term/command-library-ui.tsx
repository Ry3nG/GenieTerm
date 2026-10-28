// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0
import { globalStore } from "@/app/store/jotaiStore";
import {
    CommandHistoryLimit,
    commandConnectionLabel,
    filterCommandHistory,
    type CommandHistoryEntry,
    type CommandLibraryContext,
} from "@/util/commandlibrary";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CommandLibraryModel } from "./command-library-model";
const FieldClass =
    "min-w-0 rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-primary outline-none focus:border-accent/70 focus:ring-1 focus:ring-accent/30";
const StatusLabels = { running: "Running", success: "Succeeded", failed: "Failed", unknown: "Result unknown" };
const StatusColors = { running: "text-accent", success: "text-green-400", failed: "text-error", unknown: "text-muted" };
export type CommandLibraryPanelProps = {
    context: CommandLibraryContext;
    onInsert: (command: string) => boolean;
    onJump: (entry: CommandHistoryEntry) => boolean | Promise<boolean>;
    hasOutput: (entry: CommandHistoryEntry) => boolean | undefined;
    onClose?: () => void;
};
function LibraryButton({
    children,
    onClick,
    primary,
    disabled,
    title,
}: {
    children: ReactNode;
    onClick: () => void;
    primary?: boolean;
    disabled?: boolean;
    title?: string;
}) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40",
                primary
                    ? "bg-accent/80 text-primary hover:bg-accent"
                    : "border border-border text-secondary hover:bg-hover hover:text-primary"
            )}
        >
            {children}
        </button>
    );
}
function Destination({ context }: { context: CommandLibraryContext }) {
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            <span>Insert into</span>
            <span className="font-medium text-secondary">{commandConnectionLabel(context.connection)}</span>
            <span className="max-w-full truncate" title={context.cwd}>
                {context.cwd || "Current folder"}
            </span>
            <span className="rounded bg-hover px-1.5 py-0.5">{context.shell || "unknown shell"}</span>
        </div>
    );
}
function CommandLibraryContent({ context, onInsert, onJump, hasOutput }: CommandLibraryPanelProps) {
    const model = CommandLibraryModel.getInstance();
    const library = useAtomValue(model.libraryAtom);
    const loadError = useAtomValue(model.errorAtom);

    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const [connection, setConnection] = useState("*");
    const [cwd, setCwd] = useState("");
    const [status, setStatus] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [visibleCount, setVisibleCount] = useState(60);
    const [confirmClear, setConfirmClear] = useState(false);
    const [error, setError] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);
    const [expiredIds, setExpiredIds] = useState<string[]>([]);
    const hosts = useMemo(
        () => [...new Set(library.history.map((entry) => entry.connection))].sort(),
        [library.history]
    );
    const history = useMemo(
        () =>
            filterCommandHistory(library.history, {
                query: deferredQuery,
                connection: connection === "*" ? undefined : connection,
                cwd,
                status,
            }),
        [library.history, deferredQuery, connection, cwd, status]
    );
    const selected = history.find((entry) => entry.id === selectedId) ?? history[0];
    const outputAvailable = selected == null || expiredIds.includes(selected.id) ? false : hasOutput(selected);
    useEffect(() => setVisibleCount(60), [deferredQuery, connection, cwd, status]);
    useEffect(() => {
        rootRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    }, []);
    const insert = (command: string) => {
        if (!onInsert(command)) {
            setError(
                "Wait for an idle prompt, then try inserting again. For multiline commands, bracketed paste must be enabled."
            );
            return;
        }
        model.close();
    };
    const openOutput = async () => {
        try {
            if (await onJump(selected)) {
                model.close();
            } else {
                setExpiredIds((ids) => [...ids, selected.id]);
                setError("The original output is no longer retained. The command is still available to insert.");
            }
        } catch {
            setError("Could not open the original terminal.");
        }
    };
    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-label="Command history"
            aria-modal="true"
            className="absolute inset-2 z-40 ml-auto flex max-h-[680px] max-w-[880px] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl @container"
            onContextMenu={(event) => event.stopPropagation()}
            onPaste={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                    return;
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    model.close();
                }
                if (event.key === "Tab") {
                    const controls = Array.from(
                        rootRef.current?.querySelectorAll<HTMLElement>(
                            "button:not(:disabled), input, select, textarea, [tabindex='0']"
                        ) ?? []
                    );
                    const first = controls[0];
                    const last = controls[controls.length - 1];
                    if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last?.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first?.focus();
                    }
                }
            }}
        >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <i className="fa-solid fa-clock-rotate-left text-accent" aria-hidden="true" />
                <h2 className="min-w-0 flex-1 text-sm font-semibold">Command history</h2>
                <button
                    className="cursor-pointer rounded p-1 text-muted hover:bg-hover hover:text-primary"
                    aria-label="Close command history"
                    onClick={() => model.close()}
                >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
            </div>
            {loadError && (
                <div
                    role="alert"
                    className="flex items-center gap-2 border-b border-border bg-error/10 px-4 py-2 text-xs text-error"
                >
                    <span className="flex-1">{loadError}</span>
                    <LibraryButton onClick={() => void model.refresh()}>Retry</LibraryButton>
                </div>
            )}
            {
                <>
                    <div className="flex flex-col gap-2 border-b border-border p-3">
                        <input
                            className={FieldClass}
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={"Search commands, folders or hosts…"}
                            aria-label={"Search command history"}
                        />
                        {
                            <div className="flex flex-wrap gap-2">
                                <select
                                    className={cn(FieldClass, "flex-1")}
                                    aria-label="Filter by host"
                                    value={connection}
                                    onChange={(event) => setConnection(event.target.value)}
                                >
                                    <option value="*">All hosts</option>
                                    {hosts.map((host) => (
                                        <option key={host} value={host}>
                                            {commandConnectionLabel(host)}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className={FieldClass}
                                    aria-label="Filter by result"
                                    value={status}
                                    onChange={(event) => setStatus(event.target.value)}
                                >
                                    <option value="">All results</option>
                                    {Object.entries(StatusLabels).map(([value, label]) => (
                                        <option key={value} value={value}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    className={cn(FieldClass, "basis-full @w450:basis-auto @w450:flex-1")}
                                    value={cwd}
                                    placeholder="Filter folder…"
                                    aria-label="Filter by folder"
                                    onChange={(event) => setCwd(event.target.value)}
                                />
                            </div>
                        }
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        {
                            <>
                                {!history.length && (
                                    <div className="px-4 py-10 text-center text-xs leading-6 text-muted">
                                        {library.history.length
                                            ? "No commands match these filters."
                                            : "Your next commands will appear here.\nHistory stays on this computer."}
                                    </div>
                                )}
                                <div className="flex flex-col gap-1">
                                    {history.slice(0, visibleCount).map((entry) => (
                                        <button
                                            key={entry.id}
                                            onClick={() => {
                                                setSelectedId(entry.id);
                                                setError("");
                                            }}
                                            className={cn(
                                                "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent",
                                                selected?.id === entry.id
                                                    ? "border-accent/40 bg-accent/8"
                                                    : "border-transparent hover:bg-hover"
                                            )}
                                            aria-pressed={selected?.id === entry.id}
                                        >
                                            <span className="truncate font-mono text-xs text-primary">
                                                {entry.command}
                                            </span>
                                            <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted">
                                                <span className={StatusColors[entry.status]}>
                                                    {StatusLabels[entry.status]}
                                                    {entry.exitcode ? ` · ${entry.exitcode}` : ""}
                                                </span>
                                                <span>{commandConnectionLabel(entry.connection)}</span>
                                                <span className="min-w-0 flex-1 truncate" title={entry.cwd}>
                                                    {entry.cwd}
                                                </span>
                                                <time dateTime={new Date(entry.startts).toISOString()}>
                                                    {new Date(entry.startts).toLocaleString([], {
                                                        month: "short",
                                                        day: "numeric",
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    })}
                                                </time>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                                {history.length > visibleCount && (
                                    <div className="pt-2">
                                        <LibraryButton onClick={() => setVisibleCount(visibleCount + 60)}>
                                            Show more · {history.length - visibleCount} remaining
                                        </LibraryButton>
                                    </div>
                                )}
                            </>
                        }
                    </div>
                    {selected && (
                        <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-border bg-hover/20 p-3">
                            <pre className="max-h-28 shrink-0 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5">
                                {selected.command}
                            </pre>
                            <Destination context={context} />
                            <div className="text-[11px] text-muted">
                                {outputAvailable === true
                                    ? "Original output is retained in an open terminal."
                                    : outputAvailable === false
                                      ? "Command only · original output is no longer retained."
                                      : "Open the original terminal to check its retained output."}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <LibraryButton primary onClick={() => insert(selected.command)}>
                                    Insert
                                </LibraryButton>
                                {outputAvailable !== false && (
                                    <LibraryButton onClick={() => void openOutput()}>
                                        {outputAvailable ? "View output" : "Open original"}
                                    </LibraryButton>
                                )}

                                <LibraryButton
                                    onClick={() => void model.change({ type: "deletehistory", id: selected.id })}
                                >
                                    Delete
                                </LibraryButton>
                            </div>
                        </div>
                    )}
                    {error && (
                        <p role="status" className="border-t border-border px-3 py-2 text-xs text-warning">
                            {error}
                        </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[10px] text-muted">
                        <span className="flex-1">
                            {`Last ${CommandHistoryLimit} commands · metadata only · stored locally`}
                        </span>
                        {library.history.length > 0 && (
                            <>
                                <LibraryButton
                                    onClick={() => {
                                        if (confirmClear) {
                                            void model.change({ type: "clearhistory" });
                                            setConfirmClear(false);
                                        } else setConfirmClear(true);
                                    }}
                                >
                                    {confirmClear ? "Clear all history?" : "Clear history"}
                                </LibraryButton>
                                {confirmClear && (
                                    <LibraryButton onClick={() => setConfirmClear(false)}>Keep</LibraryButton>
                                )}
                            </>
                        )}
                    </div>
                </>
            }
        </div>
    );
}
export function CommandLibraryPanel(props: CommandLibraryPanelProps) {
    const model = CommandLibraryModel.getInstance();
    const open = useAtomValue(model.openAtom);
    const previouslyOwned = useRef(false);
    useEffect(() => {
        if (previouslyOwned.current && open == null) {
            props.onClose?.();
        }
        previouslyOwned.current = open?.blockid === props.context.blockid;
    }, [open, props.context.blockid, props.onClose]);
    useEffect(
        () => () => {
            if (globalStore.get(model.openAtom)?.blockid === props.context.blockid) {
                model.close();
            }
        },
        [props.context.blockid]
    );
    if (open?.blockid !== props.context.blockid) {
        return null;
    }
    return <CommandLibraryContent {...props} />;
}
