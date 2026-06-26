// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { createBlock, WOS } from "@/store/global";
import { cn, fireAndForget, isBlank, makeIconClass, NullAtom } from "@/util/util";
import { Atom, useAtomValue } from "jotai";
import * as React from "react";

type GitPanelTab = "changes" | "graph";
type GitChangeGroupId = "merge" | "staged" | "changes";

type GitPanelStatus = GitStatusResponse & {
    loading: boolean;
    error: string;
};

type GitPanelGraph = GitGraphResponse & {
    loading: boolean;
    error: string;
};

type GitChangeGroup = {
    id: GitChangeGroupId;
    title: string;
    files: GitStatusFile[];
};

const EmptyStatus: GitPanelStatus = {
    loading: false,
    error: "",
    branch: "",
    files: [],
    stdout: "",
    stderr: "",
    exitcode: 0,
    supported: true,
};

const EmptyGraph: GitPanelGraph = {
    loading: false,
    error: "",
    commits: [],
    stdout: "",
    stderr: "",
    exitcode: 0,
    supported: true,
};

const GraphColors = [
    "text-blue-300",
    "text-emerald-300",
    "text-amber-300",
    "text-fuchsia-300",
    "text-cyan-300",
    "text-red-300",
];

function makeFocusedBlockAtom(blockId: string): Atom<Block> {
    if (isBlank(blockId)) {
        return NullAtom as Atom<Block>;
    }
    return WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
}

function getGitContext(blockData: Block): { cwd: string; conn: string } {
    const meta = blockData?.meta ?? {};
    const cwd = (meta["cmd:cwd"] as string) || (meta["file:cwd"] as string) || "";
    const conn = (meta.connection as string) || (meta["file:connection"] as string) || "local";
    return { cwd, conn };
}

function shellQuote(value: string): string {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

function formatContextLabel(conn: string, cwd: string): string {
    if (isBlank(cwd)) {
        return "No working directory";
    }
    if (isBlank(conn) || conn === "local") {
        return cwd;
    }
    return `${conn}:${cwd}`;
}

function isConflictFile(file: GitStatusFile): boolean {
    const code = `${file.index}${file.worktree}`;
    return (
        file.index === "U" ||
        file.worktree === "U" ||
        code === "AA" ||
        code === "DD" ||
        code === "AU" ||
        code === "UA" ||
        code === "DU" ||
        code === "UD"
    );
}

function hasStagedChange(file: GitStatusFile): boolean {
    return !isConflictFile(file) && file.index !== " " && file.index !== "?";
}

function hasWorkingTreeChange(file: GitStatusFile): boolean {
    return !isConflictFile(file) && (file.worktree !== " " || file.index === "?");
}

function makeChangeGroups(files: GitStatusFile[]): GitChangeGroup[] {
    const merge = files.filter(isConflictFile);
    const staged = files.filter(hasStagedChange);
    const changes = files.filter(hasWorkingTreeChange);
    const groups: GitChangeGroup[] = [
        { id: "merge", title: "Merge Changes", files: merge },
        { id: "staged", title: "Staged Changes", files: staged },
        { id: "changes", title: "Changes", files: changes },
    ];
    return groups.filter((group) => group.files.length > 0);
}

function statusLabelForGroup(file: GitStatusFile, groupId: GitChangeGroupId): string {
    if (groupId === "merge") {
        return "!";
    }
    if (groupId === "staged") {
        return file.index === "?" ? "U" : file.index.trim() || "?";
    }
    if (file.index === "?" && file.worktree === "?") {
        return "U";
    }
    return file.worktree.trim() || file.index.trim() || "?";
}

function statusColorClass(label: string): string {
    if (label === "A") return "text-emerald-300";
    if (label === "D") return "text-red-300";
    if (label === "U" || label === "!") return "text-yellow-300";
    if (label === "R" || label === "C") return "text-blue-300";
    return "text-orange-300";
}

function refColorClass(ref: string): string {
    if (ref.startsWith("HEAD")) return "border-accent/60 bg-accent/15 text-accent";
    if (ref.startsWith("tag:")) return "border-yellow-400/40 bg-yellow-400/10 text-yellow-200";
    if (ref.includes("/")) return "border-blue-400/40 bg-blue-400/10 text-blue-200";
    return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
}

function commandForFileDiff(file: GitStatusFile, groupId: GitChangeGroupId): string {
    const quotedPath = shellQuote(file.path);
    if (groupId === "staged") {
        return `git --no-pager diff --cached -- ${quotedPath}`;
    }
    if (file.index === "?" && file.worktree === "?") {
        return `git status --short -- ${quotedPath}`;
    }
    if (groupId === "merge") {
        return `git status --short -- ${quotedPath} && git --no-pager diff -- ${quotedPath}`;
    }
    return `git --no-pager diff -- ${quotedPath}`;
}

function commandForFileAction(file: GitStatusFile, groupId: GitChangeGroupId): string {
    const quotedPath = shellQuote(file.path);
    if (groupId === "staged") {
        return `git restore --staged -- ${quotedPath}`;
    }
    return `git add -- ${quotedPath}`;
}

function formatRefLabel(ref: string): string {
    return ref
        .replace(/^refs\/heads\//, "")
        .replace(/^refs\/remotes\//, "")
        .replace(/^tag: refs\/tags\//, "tag: ");
}

function GraphGlyph({ graph }: { graph: string }) {
    const chars = graph.padEnd(8, " ").slice(0, 20).split("");
    return (
        <span className="inline-flex w-24 shrink-0 overflow-hidden font-mono text-[11px] leading-5" aria-hidden="true">
            {chars.map((char, idx) => {
                const color = GraphColors[idx % GraphColors.length];
                const display = char === " " ? "\u00a0" : char;
                return (
                    <span key={`${idx}:${char}`} className={cn("w-[7px] text-center", color)}>
                        {display}
                    </span>
                );
            })}
        </span>
    );
}

function GitPanelTabButton({
    active,
    icon,
    label,
    onClick,
}: {
    active: boolean;
    icon: string;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            className={cn(
                "flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm text-xs transition-colors",
                active ? "bg-accent/80 text-primary" : "bg-hoverbg text-secondary hover:bg-hover hover:text-primary"
            )}
            onClick={onClick}
        >
            <i className={makeIconClass(icon, true)} />
            <span>{label}</span>
        </button>
    );
}

function GitToolbarButton({
    icon,
    label,
    disabled,
    onClick,
}: {
    icon: string;
    label: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <Tooltip content={label} placement="bottom">
            <button
                type="button"
                disabled={disabled}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm text-secondary transition-colors hover:bg-hoverbg hover:text-primary disabled:cursor-default disabled:opacity-40"
                onClick={onClick}
            >
                <i className={makeIconClass(icon, true)} />
            </button>
        </Tooltip>
    );
}

function GitChangeRow({
    file,
    groupId,
    openGitCommand,
}: {
    file: GitStatusFile;
    groupId: GitChangeGroupId;
    openGitCommand: (cmd: string) => void;
}) {
    const label = statusLabelForGroup(file, groupId);
    const actionLabel = groupId === "staged" ? "Unstage" : "Stage";
    const actionIcon = groupId === "staged" ? "minus" : "plus";
    const pathLabel = file.origpath ? `${file.origpath} -> ${file.path}` : file.path;

    return (
        <div className="group flex h-7 items-center gap-1 rounded-sm px-1 text-xs hover:bg-hoverbg">
            <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                onClick={() => openGitCommand(commandForFileDiff(file, groupId))}
                title={pathLabel}
            >
                <span className={cn("w-5 shrink-0 text-center font-mono", statusColorClass(label))}>{label}</span>
                <span className="min-w-0 flex-1 truncate text-secondary group-hover:text-primary">{pathLabel}</span>
            </button>
            <Tooltip content={actionLabel} placement="left">
                <button
                    type="button"
                    className="hidden h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-secondary hover:bg-hover hover:text-primary group-hover:flex"
                    onClick={() => openGitCommand(commandForFileAction(file, groupId))}
                >
                    <i className={makeIconClass(actionIcon, true)} />
                </button>
            </Tooltip>
        </div>
    );
}

function GitChangeGroupView({
    group,
    openGitCommand,
}: {
    group: GitChangeGroup;
    openGitCommand: (cmd: string) => void;
}) {
    const stageGroup = () => {
        if (group.id === "staged") {
            openGitCommand("git restore --staged .");
            return;
        }
        openGitCommand("git add -A");
    };
    const icon = group.id === "staged" ? "minus" : "plus";
    const label = group.id === "staged" ? "Unstage All" : "Stage All";

    return (
        <section className="mb-3">
            <div className="mb-1 flex h-7 items-center gap-2 text-xs font-semibold uppercase tracking-normal text-secondary">
                <i className={makeIconClass(group.id === "staged" ? "check" : "files", true)} />
                <span className="min-w-0 flex-1 truncate">{group.title}</span>
                <span className="font-normal">{group.files.length}</span>
                <Tooltip content={label} placement="left">
                    <button
                        type="button"
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm hover:bg-hoverbg hover:text-primary"
                        onClick={stageGroup}
                    >
                        <i className={makeIconClass(icon, true)} />
                    </button>
                </Tooltip>
            </div>
            <div className="space-y-0.5">
                {group.files.map((file) => (
                    <GitChangeRow
                        key={`${group.id}:${file.index}${file.worktree}:${file.path}:${file.origpath}`}
                        file={file}
                        groupId={group.id}
                        openGitCommand={openGitCommand}
                    />
                ))}
            </div>
        </section>
    );
}

function GitGraphRow({
    commit,
    selected,
    onSelect,
}: {
    commit: GitGraphCommit;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            className={cn(
                "flex w-full cursor-pointer items-start gap-2 rounded-sm px-1.5 py-1.5 text-left text-xs transition-colors",
                selected ? "bg-accent/15" : "hover:bg-hoverbg"
            )}
            onClick={onSelect}
        >
            <GraphGlyph graph={commit.graph} />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-primary">{commit.subject}</span>
                    <span className="shrink-0 font-mono text-[11px] text-secondary">{commit.shorthash}</span>
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-secondary">
                    <span className="truncate">{commit.author}</span>
                    <span className="shrink-0">.</span>
                    <span className="shrink-0">{commit.reldate}</span>
                </div>
                {commit.refs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {commit.refs.slice(0, 4).map((ref) => (
                            <span
                                key={ref}
                                className={cn(
                                    "max-w-36 truncate rounded-sm border px-1 py-0.5 text-[10px]",
                                    refColorClass(ref)
                                )}
                                title={formatRefLabel(ref)}
                            >
                                {formatRefLabel(ref)}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </button>
    );
}

interface GitPanelProps {
    open: boolean;
    onClose: () => void;
}

export function GitPanel({ open, onClose }: GitPanelProps) {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = useAtomValue(layoutModel?.focusedNode ?? (NullAtom as Atom<any>));
    const focusedBlockId = focusedNode?.data?.blockId ?? "";
    const blockAtom = React.useMemo(() => makeFocusedBlockAtom(focusedBlockId), [focusedBlockId]);
    const blockData = useAtomValue(blockAtom);
    const { cwd, conn } = getGitContext(blockData);
    const [activeTab, setActiveTab] = React.useState<GitPanelTab>("changes");
    const [status, setStatus] = React.useState<GitPanelStatus>(EmptyStatus);
    const [graph, setGraph] = React.useState<GitPanelGraph>(EmptyGraph);
    const [commitMessage, setCommitMessage] = React.useState("");
    const [selectedHash, setSelectedHash] = React.useState("");
    const contextLabel = formatContextLabel(conn, cwd);
    const groups = React.useMemo(() => makeChangeGroups(status.files), [status.files]);
    const selectedCommit = React.useMemo(
        () => graph.commits.find((commit) => commit.hash === selectedHash) ?? graph.commits[0],
        [graph.commits, selectedHash]
    );
    const canRunCommand = !isBlank(cwd);

    const openGitCommand = React.useCallback(
        (cmd: string) => {
            const meta: MetaType = {
                view: "term",
                controller: "cmd",
                cmd,
                "cmd:cwd": cwd,
                "cmd:runonstart": true,
                connection: conn,
            };
            fireAndForget(async () => {
                await createBlock({ meta }, false, true);
            });
        },
        [conn, cwd]
    );

    const refreshStatus = React.useCallback(async () => {
        if (!open) {
            return;
        }
        if (isBlank(cwd)) {
            setStatus({ ...EmptyStatus, error: "Focus a terminal with shell integration enabled." });
            return;
        }
        setStatus((cur) => ({ ...cur, loading: true, error: "" }));
        try {
            const rtn = await RpcApi.GitStatusCommand(TabRpcClient, {
                connname: conn || "local",
                cwd,
                timeoutms: 5000,
            });
            const error = rtn.exitcode === 0 ? "" : (rtn.stderr || rtn.stdout || "git status failed").trim();
            setStatus({
                ...rtn,
                loading: false,
                error,
            });
        } catch (e) {
            setStatus({ ...EmptyStatus, error: String(e) });
        }
    }, [conn, cwd, open]);

    const refreshGraph = React.useCallback(async () => {
        if (!open || isBlank(cwd)) {
            return;
        }
        setGraph((cur) => ({ ...cur, loading: true, error: "" }));
        try {
            const rtn = await RpcApi.GitGraphCommand(TabRpcClient, {
                connname: conn || "local",
                cwd,
                limit: 100,
                timeoutms: 5000,
            });
            const error = rtn.exitcode === 0 ? "" : (rtn.stderr || rtn.stdout || "git log failed").trim();
            setGraph({
                ...rtn,
                loading: false,
                error,
            });
            setSelectedHash((cur) => cur || rtn.commits[0]?.hash || "");
        } catch (e) {
            setGraph({ ...EmptyGraph, error: String(e) });
        }
    }, [conn, cwd, open]);

    const refreshAll = React.useCallback(() => {
        fireAndForget(refreshStatus);
        if (activeTab === "graph") {
            fireAndForget(refreshGraph);
        }
    }, [activeTab, refreshGraph, refreshStatus]);

    React.useEffect(() => {
        fireAndForget(refreshStatus);
    }, [refreshStatus]);

    React.useEffect(() => {
        if (activeTab !== "graph") {
            return;
        }
        fireAndForget(refreshGraph);
    }, [activeTab, refreshGraph]);

    const commitStaged = React.useCallback(() => {
        const message = commitMessage.trim();
        if (isBlank(message)) {
            return;
        }
        openGitCommand(`git commit -m ${shellQuote(message)}`);
        setCommitMessage("");
    }, [commitMessage, openGitCommand]);

    const commitAll = React.useCallback(() => {
        const message = commitMessage.trim();
        if (isBlank(message)) {
            return;
        }
        openGitCommand(`git add -A && git commit -m ${shellQuote(message)}`);
        setCommitMessage("");
    }, [commitMessage, openGitCommand]);

    if (!open) {
        return null;
    }

    const hasRepo = status.exitcode === 0 || status.files.length > 0 || !isBlank(status.branch);
    const clean = hasRepo && status.files.length === 0 && !status.loading && isBlank(status.error);

    return (
        <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-panel text-primary">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <i className={makeIconClass("code-branch", true)} />
                <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-normal text-secondary">
                    Source Control
                </div>
                <GitToolbarButton icon="rotate-right" label="Refresh" onClick={refreshAll} />
                <GitToolbarButton
                    icon="terminal"
                    label="Git Status"
                    disabled={!canRunCommand}
                    onClick={() => openGitCommand("git status --short --branch")}
                />
                <GitToolbarButton icon="xmark" label="Close" onClick={onClose} />
            </div>
            <div className="shrink-0 border-b border-border px-3 py-3">
                <div className="mb-3 flex gap-2">
                    <GitPanelTabButton
                        active={activeTab === "changes"}
                        icon="list-check"
                        label="Changes"
                        onClick={() => setActiveTab("changes")}
                    />
                    <GitPanelTabButton
                        active={activeTab === "graph"}
                        icon="diagram-project"
                        label="Graph"
                        onClick={() => setActiveTab("graph")}
                    />
                </div>
                <div className="min-w-0 text-xs text-secondary">
                    <div className="truncate" title={contextLabel}>
                        {contextLabel}
                    </div>
                    {!isBlank(status.branch) && <div className="mt-1 truncate text-primary">{status.branch}</div>}
                </div>
            </div>

            {activeTab === "changes" ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                    {!isBlank(status.error) && (
                        <div className="mb-3 rounded-sm border border-warning/40 bg-warning/10 px-2 py-2 text-xs text-warning">
                            {status.error}
                        </div>
                    )}

                    <div className="mb-3">
                        <textarea
                            className="min-h-16 w-full resize-none rounded-sm border border-border bg-panel px-2 py-1.5 text-xs text-primary outline-none placeholder:text-secondary focus:border-accent"
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            placeholder="Message"
                        />
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                disabled={isBlank(commitMessage) || !canRunCommand}
                                className="cursor-pointer rounded-sm bg-accent/80 px-2 py-1.5 text-xs text-primary transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50"
                                onClick={commitStaged}
                            >
                                Commit
                            </button>
                            <button
                                type="button"
                                disabled={isBlank(commitMessage) || !canRunCommand}
                                className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                                onClick={commitAll}
                            >
                                Commit All
                            </button>
                        </div>
                    </div>

                    <div className="mb-3 grid grid-cols-4 gap-2">
                        <button
                            type="button"
                            disabled={!canRunCommand}
                            className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                            onClick={() => openGitCommand("git pull --ff-only")}
                        >
                            Pull
                        </button>
                        <button
                            type="button"
                            disabled={!canRunCommand}
                            className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                            onClick={() => openGitCommand("git push")}
                        >
                            Push
                        </button>
                        <button
                            type="button"
                            disabled={!canRunCommand}
                            className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                            onClick={() => openGitCommand("git fetch --all --prune")}
                        >
                            Fetch
                        </button>
                        <button
                            type="button"
                            disabled={!canRunCommand}
                            className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                            onClick={() => openGitCommand("git --no-pager diff --stat")}
                        >
                            Diff
                        </button>
                    </div>

                    {status.loading ? (
                        <div className="flex items-center gap-2 text-xs text-secondary">
                            <i className={makeIconClass("spinner", true, { spin: true })} />
                            Loading
                        </div>
                    ) : clean ? (
                        <div className="rounded-sm border border-border/70 px-3 py-8 text-center text-xs text-secondary">
                            No changes
                        </div>
                    ) : (
                        groups.map((group) => (
                            <GitChangeGroupView key={group.id} group={group} openGitCommand={openGitCommand} />
                        ))
                    )}
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                    {!isBlank(graph.error) && (
                        <div className="mx-3 mt-3 rounded-sm border border-warning/40 bg-warning/10 px-2 py-2 text-xs text-warning">
                            {graph.error}
                        </div>
                    )}
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                        {graph.loading ? (
                            <div className="flex items-center gap-2 text-xs text-secondary">
                                <i className={makeIconClass("spinner", true, { spin: true })} />
                                Loading graph
                            </div>
                        ) : graph.commits.length === 0 ? (
                            <div className="rounded-sm border border-border/70 px-3 py-8 text-center text-xs text-secondary">
                                No commits
                            </div>
                        ) : (
                            <div className="space-y-0.5">
                                {status.files.length > 0 && (
                                    <button
                                        type="button"
                                        className="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-sm bg-hoverbg px-1.5 py-1.5 text-left text-xs hover:bg-hover"
                                        onClick={() => setActiveTab("changes")}
                                    >
                                        <GraphGlyph graph="*" />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-primary">Uncommitted Changes</div>
                                            <div className="text-[11px] text-secondary">
                                                {status.files.length} changed{" "}
                                                {status.files.length === 1 ? "file" : "files"}
                                            </div>
                                        </div>
                                    </button>
                                )}
                                {graph.commits.map((commit) => (
                                    <GitGraphRow
                                        key={commit.hash}
                                        commit={commit}
                                        selected={selectedCommit?.hash === commit.hash}
                                        onSelect={() => setSelectedHash(commit.hash)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    {selectedCommit && (
                        <div className="shrink-0 border-t border-border px-3 py-3">
                            <div
                                className="mb-1 truncate text-sm font-semibold text-primary"
                                title={selectedCommit.subject}
                            >
                                {selectedCommit.subject}
                            </div>
                            <div className="mb-2 flex items-center gap-2 text-xs text-secondary">
                                <span className="font-mono">{selectedCommit.shorthash}</span>
                                <span>{selectedCommit.author}</span>
                                <span>{selectedCommit.reldate}</span>
                            </div>
                            {selectedCommit.refs.length > 0 && (
                                <div className="mb-2 flex flex-wrap gap-1">
                                    {selectedCommit.refs.map((ref) => (
                                        <span
                                            key={ref}
                                            className={cn(
                                                "max-w-40 truncate rounded-sm border px-1.5 py-0.5 text-[10px]",
                                                refColorClass(ref)
                                            )}
                                            title={formatRefLabel(ref)}
                                        >
                                            {formatRefLabel(ref)}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    className="cursor-pointer rounded-sm bg-accent/80 px-2 py-1.5 text-xs text-primary transition-colors hover:bg-accent"
                                    onClick={() =>
                                        openGitCommand(`git --no-pager show --stat --oneline ${selectedCommit.hash}`)
                                    }
                                >
                                    Show
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover"
                                    onClick={() => openGitCommand(`git checkout ${selectedCommit.hash}`)}
                                >
                                    Checkout
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}
