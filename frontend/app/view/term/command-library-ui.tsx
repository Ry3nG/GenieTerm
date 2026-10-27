// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import {
    CommandHistoryLimit,
    CommandTextLimit,
    commandConnectionLabel,
    filterCommandHistory,
    normalizeCommandRecipe,
    recipeParameterNames,
    resolveCommandRecipe,
    type CommandHistoryEntry,
    type CommandLibraryContext,
    type CommandRecipe,
    type CommandRecipeArgument,
} from "@/util/commandlibrary";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CommandLibraryModel, type CommandLibraryMode } from "./command-library-model";

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

function RecipeEditor({
    initial,
    onSave,
    onCancel,
}: {
    initial: CommandRecipe;
    onSave: (recipe: CommandRecipe) => Promise<boolean>;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const parameters = useMemo(() => recipeParameterNames(draft.template, draft.shell), [draft.template, draft.shell]);
    const valid = normalizeCommandRecipe({ ...draft, updatedts: Date.now() }) != null;
    const changeTemplate = (template: string) => {
        const names = recipeParameterNames(template, draft.shell).names;
        setDraft({
            ...draft,
            template,
            arguments: names.map(
                (name) =>
                    draft.arguments.find((arg) => arg.name === name) ?? { name, kind: "text", value: "", choices: [] }
            ),
        });
    };
    const changeArgument = (name: string, update: Partial<CommandRecipeArgument>) => {
        setDraft({
            ...draft,
            arguments: draft.arguments.map((arg) => (arg.name === name ? { ...arg, ...update } : arg)),
        });
    };
    const save = async () => {
        setBusy(true);
        setError("");
        try {
            if (await onSave({ ...draft, updatedts: Date.now() })) {
                onCancel();
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Edit recipe</h3>
                <span className="text-[11px] text-muted">Saved on this computer</span>
            </div>
            <label className="flex flex-col gap-1.5 text-[11px] text-secondary">
                Name
                <input
                    autoFocus
                    className={FieldClass}
                    maxLength={100}
                    placeholder="Find recent logs"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
            </label>
            <label className="flex flex-col gap-1.5 text-[11px] text-secondary">
                Command
                <textarea
                    className={cn(FieldClass, "min-h-24 resize-y font-mono")}
                    maxLength={CommandTextLimit}
                    value={draft.template}
                    onChange={(event) => changeTemplate(event.target.value)}
                    spellCheck={false}
                />
            </label>
            <p className="text-[11px] leading-5 text-muted">
                Use <code className="text-secondary">{"{{name}}"}</code> for a whole argument, without quotes. Values
                are quoted for {draft.shell || "the original shell"} when you insert the command.
            </p>
            {parameters.error && (
                <p role="status" className="text-[12px] text-warning">
                    {parameters.error}
                </p>
            )}
            {draft.arguments.map((arg) => (
                <div key={arg.name} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{arg.name}</span>
                        <select
                            aria-label={`Type for ${arg.name}`}
                            className={FieldClass}
                            value={arg.kind}
                            onChange={(event) =>
                                changeArgument(
                                    arg.name,
                                    event.target.value === "choice"
                                        ? { kind: "choice", choices: arg.value ? [arg.value] : [], value: arg.value }
                                        : { kind: "text", choices: [] }
                                )
                            }
                        >
                            <option value="text">Text</option>
                            <option value="choice">Choice</option>
                        </select>
                    </div>
                    {arg.kind === "choice" ? (
                        <label className="flex flex-col gap-1 text-[11px] text-muted">
                            Choices, one per line
                            <textarea
                                className={cn(FieldClass, "min-h-16 font-mono")}
                                value={arg.choices.join("\n")}
                                onChange={(event) => {
                                    const choices = event.target.value.split("\n").slice(0, 20);
                                    changeArgument(arg.name, {
                                        choices,
                                        value: choices.includes(arg.value) ? arg.value : (choices[0] ?? ""),
                                    });
                                }}
                            />
                        </label>
                    ) : (
                        <label className="flex flex-col gap-1 text-[11px] text-muted">
                            Default value
                            <input
                                className={FieldClass}
                                maxLength={1024}
                                value={arg.value}
                                onChange={(event) => changeArgument(arg.name, { value: event.target.value })}
                            />
                        </label>
                    )}
                </div>
            ))}
            <p className="break-words text-[11px] text-muted">
                Saved from {commandConnectionLabel(draft.connection)} · {draft.cwd || "current folder"} · {draft.shell}
            </p>
            {error && (
                <p role="alert" className="text-xs text-error">
                    {error}
                </p>
            )}
            <div className="flex gap-2 border-t border-border pt-3">
                <LibraryButton primary disabled={!valid || busy} onClick={() => void save()}>
                    {busy ? "Saving…" : "Save recipe"}
                </LibraryButton>
                <LibraryButton disabled={busy} onClick={onCancel}>
                    Cancel
                </LibraryButton>
            </div>
        </div>
    );
}

function RecipePreview({
    recipe,
    context,
    onInsert,
    onEdit,
    onDelete,
}: {
    recipe: CommandRecipe;
    context: CommandLibraryContext;
    onInsert: (command: string) => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [confirmDelete, setConfirmDelete] = useState(false);
    const result = useMemo(() => resolveCommandRecipe(recipe, values, context.shell), [recipe, values, context.shell]);
    return (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/50 p-3">
            <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words text-sm font-medium">{recipe.name}</h3>
                <LibraryButton onClick={onEdit}>Edit</LibraryButton>
            </div>
            {recipe.arguments.map((arg) => (
                <label key={arg.name} className="flex flex-col gap-1.5 text-xs text-secondary">
                    {arg.name}
                    {arg.kind === "choice" ? (
                        <select
                            className={FieldClass}
                            value={values[arg.name] ?? arg.value}
                            onChange={(event) => setValues({ ...values, [arg.name]: event.target.value })}
                        >
                            {arg.choices.map((choice) => (
                                <option key={choice} value={choice}>
                                    {choice}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <input
                            className={FieldClass}
                            maxLength={1024}
                            value={values[arg.name] ?? arg.value}
                            onChange={(event) => setValues({ ...values, [arg.name]: event.target.value })}
                        />
                    )}
                </label>
            ))}
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black/15 p-3 font-mono text-[12px] leading-5 text-primary">
                {result.command}
            </pre>
            <Destination context={context} />
            {(recipe.connection !== (context.connection ?? "") || recipe.cwd !== context.cwd) && (
                <p className="break-words text-[11px] text-muted">
                    Saved from {commandConnectionLabel(recipe.connection)} · {recipe.cwd || "current folder"}
                </p>
            )}
            {result.error && (
                <p role="status" className="text-xs text-warning">
                    {result.error}
                </p>
            )}
            <div className="flex flex-wrap gap-2">
                <LibraryButton primary disabled={!!result.error} onClick={() => onInsert(result.command)}>
                    Insert command
                </LibraryButton>
                <LibraryButton onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}>
                    {confirmDelete ? "Delete recipe?" : "Delete"}
                </LibraryButton>
                {confirmDelete && <LibraryButton onClick={() => setConfirmDelete(false)}>Keep</LibraryButton>}
            </div>
        </div>
    );
}

function CommandLibraryContent({
    context,
    onInsert,
    onJump,
    hasOutput,
    mode: initialMode,
    draft: initialDraft,
}: CommandLibraryPanelProps & {
    mode: CommandLibraryMode;
    draft: CommandRecipe;
}) {
    const model = CommandLibraryModel.getInstance();
    const library = useAtomValue(model.libraryAtom);
    const loadError = useAtomValue(model.errorAtom);
    const loading = useAtomValue(model.loadingAtom);
    const [mode, setMode] = useState(initialMode);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const [connection, setConnection] = useState("*");
    const [cwd, setCwd] = useState("");
    const [status, setStatus] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [recipeId, setRecipeId] = useState("");
    const [draft, setDraft] = useState(initialDraft);
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
    const recipes = useMemo(
        () =>
            library.recipes.filter((recipe) =>
                `${recipe.name}\n${recipe.template}`.toLocaleLowerCase().includes(deferredQuery.toLocaleLowerCase())
            ),
        [library.recipes, deferredQuery]
    );
    const selected = history.find((entry) => entry.id === selectedId) ?? history[0];
    const recipe = recipes.find((item) => item.id === recipeId) ?? recipes[0];
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
    const saveRecipe = async (next: CommandRecipe) => {
        const saved = await model.change({ type: "saverecipe", recipe: next });
        if (saved) {
            setRecipeId(next.id);
            setMode("recipes");
            setQuery("");
        }
        return saved;
    };
    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-label="Command library"
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
                    if (draft) setDraft(null);
                    else model.close();
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
                <h2 className="min-w-0 flex-1 text-sm font-semibold">Command library</h2>
                <button
                    className="cursor-pointer rounded p-1 text-muted hover:bg-hover hover:text-primary"
                    aria-label="Close command library"
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
            {draft ? (
                <RecipeEditor key={draft.id} initial={draft} onSave={saveRecipe} onCancel={() => setDraft(null)} />
            ) : (
                <>
                    <div
                        className="flex items-center gap-1 border-b border-border px-4 pt-2"
                        role="tablist"
                        aria-label="Command library sections"
                    >
                        {(["history", "recipes"] as const).map((tab) => (
                            <button
                                key={tab}
                                role="tab"
                                aria-selected={mode === tab}
                                className={cn(
                                    "cursor-pointer border-b-2 px-3 py-2 text-xs transition-colors",
                                    mode === tab
                                        ? "border-accent text-primary"
                                        : "border-transparent text-muted hover:text-primary"
                                )}
                                onClick={() => {
                                    setMode(tab);
                                    setQuery("");
                                    setError("");
                                }}
                            >
                                {tab === "history" ? "History" : "Recipes"}
                            </button>
                        ))}
                        <span className="flex-1" />
                        {loading && (
                            <i
                                className="fa-solid fa-circle-notch fa-spin text-xs text-muted"
                                aria-label="Refreshing"
                            />
                        )}
                    </div>
                    <div className="flex flex-col gap-2 border-b border-border p-3">
                        <input
                            className={FieldClass}
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={mode === "history" ? "Search commands, folders or hosts…" : "Search recipes…"}
                            aria-label={mode === "history" ? "Search command history" : "Search recipes"}
                        />
                        {mode === "history" ? (
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
                        ) : (
                            <div className="flex justify-end">
                                <LibraryButton onClick={() => setDraft(model.makeRecipe(context))}>
                                    New recipe
                                </LibraryButton>
                            </div>
                        )}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        {mode === "history" ? (
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
                        ) : (
                            <>
                                {!recipes.length && (
                                    <div className="px-4 py-10 text-center text-xs leading-6 text-muted">
                                        {library.recipes.length
                                            ? "No recipes match this search."
                                            : "Save a command you use often, then add reusable arguments."}
                                    </div>
                                )}
                                <div className="mb-3 flex flex-wrap gap-2">
                                    {recipes.map((item) => (
                                        <button
                                            key={item.id}
                                            className={cn(
                                                "max-w-full cursor-pointer truncate rounded-md border px-3 py-2 text-xs",
                                                recipe?.id === item.id
                                                    ? "border-accent/40 bg-accent/10 text-primary"
                                                    : "border-border text-secondary hover:bg-hover"
                                            )}
                                            onClick={() => setRecipeId(item.id)}
                                        >
                                            {item.name}
                                        </button>
                                    ))}
                                </div>
                                {recipe && (
                                    <RecipePreview
                                        key={`${recipe.id}:${recipe.updatedts}`}
                                        recipe={recipe}
                                        context={context}
                                        onInsert={insert}
                                        onEdit={() => setDraft(recipe)}
                                        onDelete={() => void model.change({ type: "deleterecipe", id: recipe.id })}
                                    />
                                )}
                            </>
                        )}
                    </div>
                    {mode === "history" && selected && (
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
                                    onClick={() =>
                                        setDraft(
                                            model.makeRecipe(
                                                {
                                                    ...context,
                                                    connection: selected.connection,
                                                    cwd: selected.cwd,
                                                    shell: selected.shell,
                                                },
                                                selected.command
                                            )
                                        )
                                    }
                                >
                                    Save recipe
                                </LibraryButton>
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
                            {mode === "history"
                                ? `Last ${CommandHistoryLimit} commands · metadata only · stored locally`
                                : "Static arguments · reviewed before insertion"}
                        </span>
                        {mode === "history" && library.history.length > 0 && (
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
            )}
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
    return (
        <CommandLibraryContent
            key={`${open.mode}:${open.draft?.id ?? ""}`}
            {...props}
            mode={open.mode}
            draft={open.draft}
        />
    );
}
