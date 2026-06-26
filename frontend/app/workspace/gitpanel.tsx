// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
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

type GitPreview = {
    title: string;
    args: string[];
    content: string;
    error: string;
    loading: boolean;
    kind: "output" | "diff";
};

type GitOperation = {
    message: string;
    error: string;
    loading: boolean;
};

type CommitFileChange = {
    status: string;
    path: string;
    origpath?: string;
};

type CommitFilesState = {
    hash: string;
    files: CommitFileChange[];
    loading: boolean;
    error: string;
};

type GitCheckoutConfirmation = {
    hash: string;
    shorthash: string;
    subject: string;
    target: string;
};

type DiffLine = {
    type: "context" | "add" | "del" | "hunk" | "meta";
    oldLine?: number;
    newLine?: number;
    text: string;
};

type DiffFile = {
    oldPath: string;
    newPath: string;
    lines: DiffLine[];
};

type GraphRenderPath = {
    d: string;
    color: string;
};

type GraphRenderPoint = {
    hash: string;
    lane: number;
    row: number;
    color: string;
    isStash: boolean;
};

type GraphRenderModel = {
    width: number;
    height: number;
    points: GraphRenderPoint[];
    paths: GraphRenderPath[];
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

const EmptyPreview: GitPreview = {
    title: "",
    args: [],
    content: "",
    error: "",
    loading: false,
    kind: "output",
};

const EmptyOperation: GitOperation = {
    message: "",
    error: "",
    loading: false,
};

const GraphStrokeColors = ["#1594e8", "#15c928", "#d800a6", "#ff9d26", "#8b5cf6", "#00b8d9", "#ef4444"];
const GraphLaneGap = 24;
const GraphLaneStart = 28;
const GraphRowHeight = 42;
const GraphWidth = 188;
const GitGraphLimit = 200;

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

export function gitCommandText(args: string[]): string {
    return ["git", ...args].map(shellQuote).join(" ");
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

function formatCommitDate(commit: GitGraphCommit): string {
    if (!commit.timestamp) {
        return commit.reldate;
    }
    return new Date(commit.timestamp * 1000).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
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

function formatRefLabel(ref: string): string {
    return ref
        .replace(/^HEAD -> /, "")
        .replace(/^refs\/heads\//, "")
        .replace(/^refs\/remotes\//, "")
        .replace(/^tag: refs\/tags\//, "tag: ");
}

export function fileDiffArgs(file: GitStatusFile, groupId: GitChangeGroupId): { args: string[]; allowExitCodes?: number[] } {
    const baseArgs = ["--no-pager", "diff", "--no-ext-diff", "--unified=8"];
    if (groupId === "staged") {
        return { args: [...baseArgs, "--cached", "--", file.path] };
    }
    if (file.index === "?" && file.worktree === "?") {
        return {
            args: ["--no-pager", "diff", "--no-ext-diff", "--unified=8", "--no-index", "--", "/dev/null", file.path],
            allowExitCodes: [0, 1],
        };
    }
    if (groupId === "merge") {
        return { args: [...baseArgs, "--", file.path], allowExitCodes: [0, 1] };
    }
    return { args: [...baseArgs, "--", file.path] };
}

export function fileActionArgs(file: GitStatusFile, groupId: GitChangeGroupId): string[] {
    if (groupId === "staged") {
        return ["restore", "--staged", "--", file.path];
    }
    return ["add", "--", file.path];
}

export function groupActionArgs(groupId: GitChangeGroupId): string[] {
    if (groupId === "staged") {
        return ["restore", "--staged", "."];
    }
    return ["add", "-A"];
}

export function commitArgs(message: string): string[] {
    return ["commit", "-m", message];
}

export function checkoutArgs(target: string): string[] {
    return ["checkout", target];
}

export function parseCommitFiles(stdout: string): CommitFileChange[] {
    return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const parts = line.split("\t");
            if (parts[0]?.startsWith("R") || parts[0]?.startsWith("C")) {
                return { status: parts[0], origpath: parts[1] ?? "", path: parts[2] ?? parts[1] ?? "" };
            }
            return { status: parts[0] ?? "M", path: parts[1] ?? "" };
        })
        .filter((file) => !isBlank(file.path));
}

export function parseUnifiedDiff(content: string): DiffFile[] {
    const files: DiffFile[] = [];
    let cur: DiffFile | null = null;
    let oldLine = 0;
    let newLine = 0;

    const ensureFile = () => {
        if (!cur) {
            cur = { oldPath: "", newPath: "", lines: [] };
            files.push(cur);
        }
        return cur;
    };

    for (const rawLine of content.split("\n")) {
        if (rawLine.startsWith("diff --git ")) {
            const match = /^diff --git a\/(.+) b\/(.+)$/.exec(rawLine);
            cur = {
                oldPath: match?.[1] ?? "",
                newPath: match?.[2] ?? match?.[1] ?? "",
                lines: [{ type: "meta", text: rawLine }],
            };
            files.push(cur);
            continue;
        }
        const file = ensureFile();
        if (rawLine.startsWith("--- ")) {
            file.oldPath = rawLine.replace(/^---\s+(a\/)?/, "");
            file.lines.push({ type: "meta", text: rawLine });
            continue;
        }
        if (rawLine.startsWith("+++ ")) {
            file.newPath = rawLine.replace(/^\+\+\+\s+(b\/)?/, "");
            file.lines.push({ type: "meta", text: rawLine });
            continue;
        }
        const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/.exec(rawLine);
        if (hunkMatch) {
            oldLine = Number(hunkMatch[1]);
            newLine = Number(hunkMatch[2]);
            file.lines.push({ type: "hunk", text: rawLine });
            continue;
        }
        if (rawLine.startsWith("+")) {
            file.lines.push({ type: "add", newLine, text: rawLine.slice(1) });
            newLine++;
            continue;
        }
        if (rawLine.startsWith("-")) {
            file.lines.push({ type: "del", oldLine, text: rawLine.slice(1) });
            oldLine++;
            continue;
        }
        if (rawLine.startsWith(" ")) {
            file.lines.push({ type: "context", oldLine, newLine, text: rawLine.slice(1) });
            oldLine++;
            newLine++;
            continue;
        }
        file.lines.push({ type: "meta", text: rawLine });
    }

    return files.filter((file) => file.lines.length > 0);
}

function graphColorForColumn(column: number): string {
    return GraphStrokeColors[column % GraphStrokeColors.length];
}

function graphLaneX(lane: number): number {
    return GraphLaneStart + lane * GraphLaneGap;
}

function compactGraphLanes(lanes: string[]): string[] {
    const next = [...lanes];
    while (next.length > 0 && isBlank(next[next.length - 1])) {
        next.pop();
    }
    return next;
}

function allocateGraphLane(lanes: string[], hash: string): number {
    const emptyLane = lanes.findIndex((lane) => isBlank(lane));
    if (emptyLane >= 0) {
        lanes[emptyLane] = hash;
        return emptyLane;
    }
    lanes.push(hash);
    return lanes.length - 1;
}

export function makeGraphRenderModel(commits: GitGraphCommit[]): GraphRenderModel {
    const paths: GraphRenderPath[] = [];
    const points: GraphRenderPoint[] = [];
    const colorByHash = new Map<string, string>();
    let lanes: string[] = [];
    let nextColor = 0;

    const colorFor = (hash: string, fallback?: string) => {
        if (isBlank(hash)) {
            return fallback ?? GraphStrokeColors[0];
        }
        if (!colorByHash.has(hash)) {
            colorByHash.set(hash, fallback ?? graphColorForColumn(nextColor++));
        }
        return colorByHash.get(hash) ?? GraphStrokeColors[0];
    };

    const addLine = (fromLane: number, fromY: number, toLane: number, toY: number, color: string) => {
        const x1 = graphLaneX(fromLane);
        const x2 = graphLaneX(toLane);
        if (fromLane === toLane) {
            paths.push({ d: `M ${x1} ${fromY} L ${x2} ${toY}`, color });
            return;
        }
        const bend = Math.min(18, Math.abs(toY - fromY) * 0.45);
        paths.push({
            d: `M ${x1} ${fromY} C ${x1} ${fromY + bend}, ${x2} ${toY - bend}, ${x2} ${toY}`,
            color,
        });
    };

    commits.forEach((commit, row) => {
        const rowTop = row * GraphRowHeight;
        const rowMid = rowTop + GraphRowHeight / 2;
        const rowBottom = rowTop + GraphRowHeight;
        const lanesBefore = [...lanes];
        let lane = lanes.indexOf(commit.hash);
        const isNewLane = lane < 0;
        if (isNewLane) {
            lane = allocateGraphLane(lanes, commit.hash);
        }
        const commitColor = colorFor(commit.hash);

        lanesBefore.forEach((hash, activeLane) => {
            if (!isBlank(hash) && activeLane !== lane) {
                addLine(activeLane, rowTop, activeLane, rowBottom, colorFor(hash));
            }
        });
        if (!isNewLane) {
            addLine(lane, rowTop, lane, rowMid, commitColor);
        }

        points.push({
            hash: commit.hash,
            lane,
            row,
            color: commitColor,
            isStash: commit.refs.some((ref) => ref.includes("stash")),
        });

        const [firstParent, ...otherParents] = commit.parents ?? [];
        if (isBlank(firstParent)) {
            lanes[lane] = "";
            lanes = compactGraphLanes(lanes);
            return;
        }

        const firstParentLane = lanes.indexOf(firstParent);
        if (firstParentLane >= 0 && firstParentLane !== lane) {
            addLine(lane, rowMid, firstParentLane, rowBottom, colorFor(firstParent));
            lanes[lane] = "";
        } else {
            colorFor(firstParent, commitColor);
            lanes[lane] = firstParent;
            addLine(lane, rowMid, lane, rowBottom, commitColor);
        }

        otherParents.forEach((parent) => {
            if (isBlank(parent)) {
                return;
            }
            let targetLane = lanes.indexOf(parent);
            if (targetLane < 0) {
                targetLane = allocateGraphLane(lanes, parent);
            }
            addLine(lane, rowMid, targetLane, rowBottom, colorFor(parent));
        });

        lanes = compactGraphLanes(lanes);
    });

    const maxLane = Math.max(0, ...points.map((point) => point.lane));
    return {
        width: Math.max(GraphWidth, graphLaneX(maxLane) + GraphLaneGap),
        height: commits.length * GraphRowHeight,
        points,
        paths,
    };
}

function GitGraphCanvas({ model, topOffset }: { model: GraphRenderModel; topOffset: number }) {
    if (model.height === 0) {
        return null;
    }
    return (
        <svg
            className="pointer-events-none absolute left-0 z-20"
            style={{ top: topOffset }}
            width={model.width}
            height={model.height}
            viewBox={`0 0 ${model.width} ${model.height}`}
            aria-hidden="true"
        >
            {model.paths.map((path, idx) => (
                <g key={`${idx}:${path.d}`}>
                    <path d={path.d} fill="none" stroke="rgba(0,0,0,0.38)" strokeWidth="5" strokeLinecap="round" />
                    <path d={path.d} fill="none" stroke={path.color} strokeWidth="2.5" strokeLinecap="round" />
                </g>
            ))}
            {model.points.map((point) => {
                const cx = graphLaneX(point.lane);
                const cy = point.row * GraphRowHeight + GraphRowHeight / 2;
                return (
                    <g key={point.hash}>
                        <circle cx={cx} cy={cy} r="7" fill="var(--background)" />
                        <circle cx={cx} cy={cy} r={point.isStash ? "5.5" : "5"} fill={point.color} />
                        {point.isStash && <circle cx={cx} cy={cy} r="2.2" fill="var(--background)" />}
                    </g>
                );
            })}
        </svg>
    );
}

export function checkoutTargetForCommit(commit: GitGraphCommit): { target: string; detached: boolean } {
    for (const ref of commit.refs) {
        if (ref.startsWith("HEAD -> ")) {
            return { target: formatRefLabel(ref), detached: false };
        }
    }
    for (const ref of commit.refs) {
        const label = formatRefLabel(ref);
        if (
            isBlank(label) ||
            label === "HEAD" ||
            label.startsWith("tag:") ||
            label.startsWith("origin/") ||
            label.startsWith("upstream/") ||
            label.includes("stash")
        ) {
            continue;
        }
        return { target: label, detached: false };
    }
    return { target: commit.hash, detached: true };
}

export function checkoutConfirmationForCommit(commit: GitGraphCommit): GitCheckoutConfirmation | null {
    const checkout = checkoutTargetForCommit(commit);
    if (!checkout.detached) {
        return null;
    }
    return {
        hash: commit.hash,
        shorthash: commit.shorthash,
        subject: commit.subject,
        target: checkout.target,
    };
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
    spin,
    onClick,
}: {
    icon: string;
    label: string;
    disabled?: boolean;
    spin?: boolean;
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
                <i className={makeIconClass(icon, true, { spin })} />
            </button>
        </Tooltip>
    );
}

function GitChangeRow({
    file,
    groupId,
    onDiff,
    onAction,
}: {
    file: GitStatusFile;
    groupId: GitChangeGroupId;
    onDiff: (file: GitStatusFile, groupId: GitChangeGroupId) => void;
    onAction: (file: GitStatusFile, groupId: GitChangeGroupId) => void;
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
                onClick={() => onDiff(file, groupId)}
                title={pathLabel}
            >
                <span className={cn("w-5 shrink-0 text-center font-mono", statusColorClass(label))}>{label}</span>
                <span className="min-w-0 flex-1 truncate text-secondary group-hover:text-primary">{pathLabel}</span>
            </button>
            <Tooltip content={actionLabel} placement="left">
                <button
                    type="button"
                    className="hidden h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-secondary hover:bg-hover hover:text-primary group-hover:flex"
                    onClick={() => onAction(file, groupId)}
                >
                    <i className={makeIconClass(actionIcon, true)} />
                </button>
            </Tooltip>
        </div>
    );
}

function GitChangeGroupView({
    group,
    onDiff,
    onAction,
    onGroupAction,
}: {
    group: GitChangeGroup;
    onDiff: (file: GitStatusFile, groupId: GitChangeGroupId) => void;
    onAction: (file: GitStatusFile, groupId: GitChangeGroupId) => void;
    onGroupAction: (groupId: GitChangeGroupId) => void;
}) {
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
                        onClick={() => onGroupAction(group.id)}
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
                        onDiff={onDiff}
                        onAction={onAction}
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
                "relative z-10 grid h-[42px] w-full cursor-pointer grid-cols-[190px_minmax(260px,1fr)_116px_126px_78px] items-center border-b border-border/60 px-2 text-left text-xs transition-colors",
                selected ? "bg-accent/15" : "hover:bg-hoverbg"
            )}
            onClick={onSelect}
        >
            <div />
            <div className="min-w-0 pr-3">
                <div className="flex min-w-0 items-center gap-1">
                    {commit.refs.slice(0, 3).map((ref) => (
                        <span
                            key={ref}
                            className={cn(
                                "max-w-32 shrink-0 truncate rounded-sm border px-1.5 py-0.5 text-[10px]",
                                refColorClass(ref)
                            )}
                            title={formatRefLabel(ref)}
                        >
                            {formatRefLabel(ref)}
                        </span>
                    ))}
                    <span className="min-w-0 truncate text-primary">{commit.subject}</span>
                </div>
            </div>
            <div className="truncate pr-3 text-secondary">{formatCommitDate(commit)}</div>
            <div className="truncate pr-3 text-secondary">{commit.author}</div>
            <div className="truncate font-mono text-secondary">{commit.shorthash}</div>
        </button>
    );
}

function DiffLineRow({ line }: { line: DiffLine }) {
    const oldLabel = line.oldLine ? String(line.oldLine) : "";
    const newLabel = line.newLine ? String(line.newLine) : "";
    const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : line.type === "context" ? " " : "";
    return (
        <div
            className={cn(
                "grid min-h-5 grid-cols-[48px_48px_24px_minmax(0,1fr)] font-mono text-[11px] leading-5",
                line.type === "add" && "bg-emerald-500/12",
                line.type === "del" && "bg-red-500/12",
                line.type === "hunk" && "bg-accent/12 text-accent",
                line.type === "meta" && "text-secondary"
            )}
        >
            <div className="select-none border-r border-border/50 pr-2 text-right text-secondary/80">{oldLabel}</div>
            <div className="select-none border-r border-border/50 pr-2 text-right text-secondary/80">{newLabel}</div>
            <div
                className={cn(
                    "select-none text-center",
                    line.type === "add" && "text-emerald-300",
                    line.type === "del" && "text-red-300"
                )}
            >
                {prefix}
            </div>
            <div className="min-w-0 whitespace-pre px-2 text-primary">{line.text || " "}</div>
        </div>
    );
}

function GitDiffViewer({ content }: { content: string }) {
    const files = React.useMemo(() => parseUnifiedDiff(content), [content]);
    if (files.length === 0) {
        return (
            <div className="flex h-full items-center justify-center px-3 text-xs text-secondary">
                No textual diff for this selection.
            </div>
        );
    }
    return (
        <div className="h-full overflow-auto bg-panel">
            {files.map((file, fileIdx) => (
                <section key={`${file.oldPath}:${file.newPath}:${fileIdx}`} className="border-b border-border">
                    <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-border bg-panel px-3 text-xs">
                        <i className={makeIconClass("file-lines", true)} />
                        <span
                            className="min-w-0 flex-1 truncate font-semibold text-primary"
                            title={file.newPath || file.oldPath}
                        >
                            {file.newPath || file.oldPath || "diff"}
                        </span>
                    </div>
                    <div>
                        {file.lines.map((line, idx) => (
                            <DiffLineRow
                                key={`${fileIdx}:${idx}:${line.type}:${line.oldLine}:${line.newLine}`}
                                line={line}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function GitPreviewPanel({
    preview,
    onClose,
    onOpenTerminal,
}: {
    preview: GitPreview;
    onClose: () => void;
    onOpenTerminal: (args: string[]) => void;
}) {
    if (isBlank(preview.title)) {
        return null;
    }
    return (
        <div
            className={cn(
                "shrink-0 border-t border-border bg-panel",
                preview.kind === "diff" ? "h-[42vh] min-h-64" : "max-h-64"
            )}
        >
            <div className="flex h-8 items-center gap-2 border-b border-border px-3">
                <i className={makeIconClass(preview.error ? "triangle-exclamation" : "file-lines", true)} />
                <div className="min-w-0 flex-1 truncate text-xs font-semibold text-primary" title={preview.title}>
                    {preview.title}
                </div>
                <GitToolbarButton
                    icon="terminal"
                    label="Open Command in Terminal"
                    disabled={preview.args.length === 0}
                    onClick={() => onOpenTerminal(preview.args)}
                />
                <GitToolbarButton icon="xmark" label="Close Output" onClick={onClose} />
            </div>
            <div className={cn(preview.kind === "diff" ? "h-[calc(42vh-2rem)] min-h-56" : "max-h-56 overflow-auto")}>
                {preview.loading ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-secondary">
                        <i className={makeIconClass("spinner", true, { spin: true })} />
                        Loading
                    </div>
                ) : preview.error ? (
                    <pre className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-5 text-warning">
                        {preview.error}
                    </pre>
                ) : preview.kind === "diff" ? (
                    <GitDiffViewer content={preview.content} />
                ) : (
                    <pre className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-5 text-secondary">
                        {preview.content || "No output"}
                    </pre>
                )}
            </div>
        </div>
    );
}

interface GitPanelProps {
    open: boolean;
    onClose: () => void;
    previewData?: {
        cwd: string;
        conn?: string;
        activeTab?: GitPanelTab;
        status?: Partial<GitPanelStatus>;
        graph?: Partial<GitPanelGraph>;
        selectedHash?: string;
        preview?: GitPreview;
        commitFiles?: CommitFilesState;
        pendingCheckout?: GitCheckoutConfirmation;
    };
}

export function GitPanel({ open, onClose, previewData }: GitPanelProps) {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = useAtomValue(layoutModel?.focusedNode ?? (NullAtom as Atom<any>));
    const focusedBlockId = focusedNode?.data?.blockId ?? "";
    const blockAtom = React.useMemo(() => makeFocusedBlockAtom(focusedBlockId), [focusedBlockId]);
    const blockData = useAtomValue(blockAtom);
    const gitContext = previewData
        ? { cwd: previewData.cwd, conn: previewData.conn ?? "local" }
        : getGitContext(blockData);
    const { cwd, conn } = gitContext;
    const [activeTab, setActiveTab] = React.useState<GitPanelTab>(previewData?.activeTab ?? "changes");
    const [status, setStatus] = React.useState<GitPanelStatus>({ ...EmptyStatus, ...previewData?.status });
    const [graph, setGraph] = React.useState<GitPanelGraph>({ ...EmptyGraph, ...previewData?.graph });
    const [commitMessage, setCommitMessage] = React.useState("");
    const [selectedHash, setSelectedHash] = React.useState(previewData?.selectedHash ?? "");
    const [preview, setPreview] = React.useState<GitPreview>(previewData?.preview ?? EmptyPreview);
    const [operation, setOperation] = React.useState<GitOperation>(EmptyOperation);
    const [graphFilter, setGraphFilter] = React.useState("");
    const [pendingCheckout, setPendingCheckout] = React.useState<GitCheckoutConfirmation>(previewData?.pendingCheckout);
    const [commitFiles, setCommitFiles] = React.useState<CommitFilesState>(
        previewData?.commitFiles ?? {
            hash: "",
            files: [],
            loading: false,
            error: "",
        }
    );
    const contextLabel = formatContextLabel(conn, cwd);
    const groups = React.useMemo(() => makeChangeGroups(status.files), [status.files]);
    const filteredCommits = React.useMemo(() => {
        const filter = graphFilter.trim().toLocaleLowerCase();
        if (isBlank(filter)) {
            return graph.commits;
        }
        return graph.commits.filter((commit) =>
            [commit.subject, commit.author, commit.hash, commit.shorthash, ...commit.refs]
                .join(" ")
                .toLocaleLowerCase()
                .includes(filter)
        );
    }, [graph.commits, graphFilter]);
    const graphModel = React.useMemo(() => makeGraphRenderModel(filteredCommits), [filteredCommits]);
    const selectedCommit = React.useMemo(
        () => graph.commits.find((commit) => commit.hash === selectedHash) ?? filteredCommits[0] ?? graph.commits[0],
        [filteredCommits, graph.commits, selectedHash]
    );
    const canRunCommand = !isBlank(cwd);
    const busy = status.loading || graph.loading || operation.loading || preview.loading;
    const activeCheckoutConfirmation =
        selectedCommit && pendingCheckout?.hash === selectedCommit.hash ? pendingCheckout : null;

    const openGitArgsInTerminal = React.useCallback(
        (args: string[]) => {
            const meta: MetaType = {
                view: "term",
                controller: "cmd",
                cmd: gitCommandText(args),
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
        if (previewData) {
            return;
        }
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
    }, [conn, cwd, open, previewData]);

    const refreshGraph = React.useCallback(async () => {
        if (previewData) {
            return;
        }
        if (!open || isBlank(cwd)) {
            return;
        }
        setGraph((cur) => ({ ...cur, loading: true, error: "" }));
        try {
            const rtn = await RpcApi.GitGraphCommand(TabRpcClient, {
                connname: conn || "local",
                cwd,
                limit: GitGraphLimit,
                timeoutms: 8000,
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
    }, [conn, cwd, open, previewData]);

    const refreshAll = React.useCallback(() => {
        fireAndForget(refreshStatus);
        fireAndForget(refreshGraph);
    }, [refreshGraph, refreshStatus]);

    const runGit = React.useCallback(
        async (args: string[], allowExitCodes: number[] = [0]): Promise<GitRunResponse> => {
            if (!canRunCommand) {
                return {
                    stdout: "",
                    stderr: "Focus a terminal with shell integration enabled.",
                    exitcode: -1,
                    supported: false,
                };
            }
            const rtn = await RpcApi.GitRunCommand(TabRpcClient, {
                connname: conn || "local",
                cwd,
                args,
                timeoutms: 15000,
            });
            if (!allowExitCodes.includes(rtn.exitcode)) {
                return rtn;
            }
            return rtn;
        },
        [canRunCommand, conn, cwd]
    );

    const showGitOutput = React.useCallback(
        async (title: string, args: string[], allowExitCodes: number[] = [0], kind: GitPreview["kind"] = "output") => {
            setPreview({ title, args, content: "", error: "", loading: true, kind });
            try {
                const rtn = await runGit(args, allowExitCodes);
                const output = [rtn.stdout, rtn.stderr]
                    .filter((part) => !isBlank(part))
                    .join("\n")
                    .trim();
                const error = allowExitCodes.includes(rtn.exitcode) ? "" : output || `git exited with ${rtn.exitcode}`;
                setPreview({
                    title,
                    args,
                    content: error ? "" : output,
                    error,
                    loading: false,
                    kind,
                });
            } catch (e) {
                setPreview({ title, args, content: "", error: String(e), loading: false, kind });
            }
        },
        [runGit]
    );

    const runGitAction = React.useCallback(
        async (title: string, args: string[], refresh = true) => {
            setOperation({ message: title, error: "", loading: true });
            try {
                const rtn = await runGit(args);
                const output = [rtn.stdout, rtn.stderr]
                    .filter((part) => !isBlank(part))
                    .join("\n")
                    .trim();
                if (rtn.exitcode !== 0) {
                    setOperation({ message: "", error: output || `git exited with ${rtn.exitcode}`, loading: false });
                    return;
                }
                setOperation({ message: output || title, error: "", loading: false });
                if (refresh) {
                    await refreshStatus();
                    if (activeTab === "graph") {
                        await refreshGraph();
                    }
                }
            } catch (e) {
                setOperation({ message: "", error: String(e), loading: false });
            }
        },
        [activeTab, refreshGraph, refreshStatus, runGit]
    );

    React.useEffect(() => {
        if (previewData) {
            return;
        }
        fireAndForget(refreshStatus);
    }, [previewData, refreshStatus]);

    React.useEffect(() => {
        if (previewData) {
            return;
        }
        if (activeTab !== "graph") {
            return;
        }
        fireAndForget(refreshGraph);
    }, [activeTab, previewData, refreshGraph]);

    React.useEffect(() => {
        if (previewData) {
            return;
        }
        setPendingCheckout(null);
        if (activeTab !== "graph" || !selectedCommit) {
            return;
        }
        let active = true;
        setCommitFiles({ hash: selectedCommit.hash, files: [], loading: true, error: "" });
        fireAndForget(async () => {
            try {
                const rtn = await runGit([
                    "--no-pager",
                    "show",
                    "--name-status",
                    "--format=",
                    "--find-renames",
                    selectedCommit.hash,
                ]);
                if (!active) {
                    return;
                }
                const output = [rtn.stdout, rtn.stderr]
                    .filter((part) => !isBlank(part))
                    .join("\n")
                    .trim();
                setCommitFiles({
                    hash: selectedCommit.hash,
                    files: rtn.exitcode === 0 ? parseCommitFiles(rtn.stdout) : [],
                    loading: false,
                    error: rtn.exitcode === 0 ? "" : output || `git exited with ${rtn.exitcode}`,
                });
            } catch (e) {
                if (active) {
                    setCommitFiles({ hash: selectedCommit.hash, files: [], loading: false, error: String(e) });
                }
            }
        });
        return () => {
            active = false;
        };
    }, [activeTab, previewData, runGit, selectedCommit]);

    const showFileDiff = React.useCallback(
        (file: GitStatusFile, groupId: GitChangeGroupId) => {
            const diff = fileDiffArgs(file, groupId);
            fireAndForget(async () => {
                await showGitOutput(
                    file.origpath ? `${file.origpath} -> ${file.path}` : file.path,
                    diff.args,
                    diff.allowExitCodes ?? [0],
                    "diff"
                );
            });
        },
        [showGitOutput]
    );

    const showCommitFileDiff = React.useCallback(
        (commit: GitGraphCommit, file: CommitFileChange) => {
            const title = file.origpath ? `${file.origpath} -> ${file.path}` : file.path;
            fireAndForget(async () => {
                await showGitOutput(
                    title,
                    [
                        "--no-pager",
                        "show",
                        "--no-ext-diff",
                        "--unified=8",
                        "--find-renames",
                        "--format=",
                        commit.hash,
                        "--",
                        file.path,
                    ],
                    [0],
                    "diff"
                );
            });
        },
        [showGitOutput]
    );

    const stageFile = React.useCallback(
        (file: GitStatusFile, groupId: GitChangeGroupId) => {
            fireAndForget(async () => {
                await runGitAction(
                    groupId === "staged" ? "Unstaged file" : "Staged file",
                    fileActionArgs(file, groupId)
                );
            });
        },
        [runGitAction]
    );

    const stageGroup = React.useCallback(
        (groupId: GitChangeGroupId) => {
            fireAndForget(async () => {
                await runGitAction(
                    groupId === "staged" ? "Unstaged all files" : "Staged all files",
                    groupActionArgs(groupId)
                );
            });
        },
        [runGitAction]
    );

    const commitStaged = React.useCallback(() => {
        const message = commitMessage.trim();
        if (isBlank(message)) {
            return;
        }
        fireAndForget(async () => {
            await runGitAction("Committed staged changes", commitArgs(message));
            setCommitMessage("");
        });
    }, [commitMessage, runGitAction]);

    const commitAll = React.useCallback(() => {
        const message = commitMessage.trim();
        if (isBlank(message)) {
            return;
        }
        fireAndForget(async () => {
            await runGitAction("Staged all files", groupActionArgs("changes"), false);
            await runGitAction("Committed all changes", commitArgs(message));
            setCommitMessage("");
        });
    }, [commitMessage, runGitAction]);

    const checkoutCommit = React.useCallback(
        (commit: GitGraphCommit) => {
            const confirmation = checkoutConfirmationForCommit(commit);
            if (confirmation) {
                setPendingCheckout(confirmation);
                return;
            }
            const checkout = checkoutTargetForCommit(commit);
            setPendingCheckout(null);
            fireAndForget(async () => {
                await runGitAction("Checked out branch", checkoutArgs(checkout.target));
            });
        },
        [runGitAction]
    );

    const confirmCheckoutCommit = React.useCallback(() => {
        if (!activeCheckoutConfirmation) {
            return;
        }
        const checkout = activeCheckoutConfirmation;
        setPendingCheckout(null);
        fireAndForget(async () => {
            await runGitAction("Checked out revision", checkoutArgs(checkout.target));
        });
    }, [activeCheckoutConfirmation, runGitAction]);

    if (!open) {
        return null;
    }

    const hasRepo = status.exitcode === 0 || status.files.length > 0 || !isBlank(status.branch);
    const clean = hasRepo && status.files.length === 0 && !status.loading && isBlank(status.error);

    return (
        <aside
            className={cn(
                "flex h-full max-w-full shrink-0 flex-col border-l border-border bg-panel text-primary transition-[width] duration-150",
                activeTab === "graph"
                    ? "w-[min(960px,calc(100vw-2rem))]"
                    : preview.kind === "diff"
                      ? "w-[min(760px,calc(100vw-2rem))]"
                      : "w-[min(460px,calc(100vw-2rem))]"
            )}
        >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <i className={makeIconClass("code-branch", true)} />
                <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-normal text-secondary">
                    Source Control
                </div>
                <GitToolbarButton icon="rotate-right" label="Refresh" spin={busy} onClick={refreshAll} />
                <GitToolbarButton
                    icon="terminal"
                    label="Open Git Status in Terminal"
                    disabled={!canRunCommand}
                    onClick={() => openGitArgsInTerminal(["status", "--short", "--branch"])}
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
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs">
                    <div className="min-w-0">
                        <div className="truncate text-secondary" title={contextLabel}>
                            {contextLabel}
                        </div>
                        {!isBlank(status.branch) && <div className="mt-1 truncate text-primary">{status.branch}</div>}
                    </div>
                    <div className="flex items-center gap-2 text-secondary">
                        <span>{status.files.length} changes</span>
                    </div>
                </div>
                {(!isBlank(operation.error) || !isBlank(operation.message)) && (
                    <div
                        className={cn(
                            "mt-2 truncate rounded-sm border px-2 py-1 text-xs",
                            operation.error
                                ? "border-warning/40 bg-warning/10 text-warning"
                                : "border-border bg-hoverbg/60 text-secondary"
                        )}
                        title={operation.error || operation.message}
                    >
                        {operation.loading ? "Running..." : operation.error || operation.message}
                    </div>
                )}
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
                                disabled={isBlank(commitMessage) || !canRunCommand || operation.loading}
                                className="cursor-pointer rounded-sm bg-accent/80 px-2 py-1.5 text-xs text-primary transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50"
                                onClick={commitStaged}
                            >
                                Commit
                            </button>
                            <button
                                type="button"
                                disabled={isBlank(commitMessage) || !canRunCommand || operation.loading}
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
                            disabled={!canRunCommand || operation.loading}
                            className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                            onClick={() =>
                                fireAndForget(
                                    async () => await runGitAction("Pulled latest changes", ["pull", "--ff-only"])
                                )
                            }
                        >
                            Pull
                        </button>
                        <button
                            type="button"
                            disabled={!canRunCommand || operation.loading}
                            className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                            onClick={() => fireAndForget(async () => await runGitAction("Pushed commits", ["push"]))}
                        >
                            Push
                        </button>
                        <button
                            type="button"
                            disabled={!canRunCommand || operation.loading}
                            className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                            onClick={() =>
                                fireAndForget(
                                    async () => await runGitAction("Fetched remotes", ["fetch", "--all", "--prune"])
                                )
                            }
                        >
                            Fetch
                        </button>
                        <button
                            type="button"
                            disabled={!canRunCommand || preview.loading}
                            className="cursor-pointer rounded-sm bg-hoverbg px-2 py-1.5 text-xs text-primary transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-50"
                            onClick={() =>
                                fireAndForget(
                                    async () =>
                                        await showGitOutput(
                                            "Working Tree Diff",
                                            ["--no-pager", "diff", "--no-ext-diff", "--unified=8"],
                                            [0],
                                            "diff"
                                        )
                                )
                            }
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
                            <GitChangeGroupView
                                key={group.id}
                                group={group}
                                onDiff={showFileDiff}
                                onAction={stageFile}
                                onGroupAction={stageGroup}
                            />
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
                    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                        <i className={makeIconClass("magnifying-glass", true)} />
                        <input
                            className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-panel px-2 text-xs text-primary outline-none placeholder:text-secondary focus:border-accent"
                            value={graphFilter}
                            onChange={(e) => setGraphFilter(e.target.value)}
                            placeholder="Find commits, branches, tags, author, hash"
                        />
                        {!isBlank(graphFilter) && (
                            <GitToolbarButton icon="xmark" label="Clear Find" onClick={() => setGraphFilter("")} />
                        )}
                        <span className="text-xs text-secondary">
                            {filteredCommits.length}/{graph.commits.length}
                        </span>
                    </div>
                    <div className="grid h-8 shrink-0 grid-cols-[190px_minmax(260px,1fr)_116px_126px_78px] items-center border-b border-border px-2 text-[11px] font-semibold uppercase tracking-normal text-secondary">
                        <div>Graph</div>
                        <div>Commit</div>
                        <div>Date</div>
                        <div>Author</div>
                        <div>Hash</div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                        {graph.loading ? (
                            <div className="flex items-center gap-2 px-3 py-3 text-xs text-secondary">
                                <i className={makeIconClass("spinner", true, { spin: true })} />
                                Loading graph
                            </div>
                        ) : filteredCommits.length === 0 ? (
                            <div className="m-3 rounded-sm border border-border/70 px-3 py-8 text-center text-xs text-secondary">
                                No commits
                            </div>
                        ) : (
                            <div className="relative">
                                <GitGraphCanvas
                                    model={graphModel}
                                    topOffset={status.files.length > 0 ? GraphRowHeight : 0}
                                />
                                {status.files.length > 0 && (
                                    <button
                                        type="button"
                                        className="relative z-10 grid h-[42px] w-full cursor-pointer grid-cols-[190px_minmax(260px,1fr)_116px_126px_78px] items-center border-b border-border/60 bg-hoverbg/60 px-2 text-left text-xs hover:bg-hover"
                                        onClick={() => setActiveTab("changes")}
                                    >
                                        <div className="pl-[14px]">
                                            <span className="inline-block h-3 w-3 rounded-full bg-yellow-300" />
                                        </div>
                                        <div className="truncate text-primary">Uncommitted Changes</div>
                                        <div className="text-secondary">Working tree</div>
                                        <div className="text-secondary">{status.files.length} files</div>
                                        <div className="font-mono text-secondary">local</div>
                                    </button>
                                )}
                                {filteredCommits.map((commit) => (
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
                                <span>{formatCommitDate(selectedCommit)}</span>
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
                            <div className="mb-2 max-h-32 overflow-auto rounded-sm border border-border">
                                <div className="flex h-7 items-center gap-2 border-b border-border bg-hoverbg/40 px-2 text-xs font-semibold text-secondary">
                                    <i className={makeIconClass("files", true)} />
                                    <span className="min-w-0 flex-1">Files Changed</span>
                                    {commitFiles.loading && (
                                        <i className={makeIconClass("spinner", true, { spin: true })} />
                                    )}
                                    {!commitFiles.loading && <span>{commitFiles.files.length}</span>}
                                </div>
                                {!isBlank(commitFiles.error) ? (
                                    <div className="px-2 py-2 text-xs text-warning">{commitFiles.error}</div>
                                ) : commitFiles.loading ? (
                                    <div className="px-2 py-2 text-xs text-secondary">Loading files</div>
                                ) : commitFiles.files.length === 0 ? (
                                    <div className="px-2 py-2 text-xs text-secondary">No file changes</div>
                                ) : (
                                    commitFiles.files.map((file) => {
                                        const pathLabel = file.origpath
                                            ? `${file.origpath} -> ${file.path}`
                                            : file.path;
                                        return (
                                            <button
                                                key={`${file.status}:${file.path}:${file.origpath}`}
                                                type="button"
                                                className="group flex h-7 w-full cursor-pointer items-center gap-2 px-2 text-left text-xs hover:bg-hoverbg"
                                                title={pathLabel}
                                                onClick={() => showCommitFileDiff(selectedCommit, file)}
                                            >
                                                <span
                                                    className={cn(
                                                        "w-8 shrink-0 text-center font-mono",
                                                        statusColorClass(file.status[0] ?? "M")
                                                    )}
                                                >
                                                    {file.status}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-secondary group-hover:text-primary">
                                                    {pathLabel}
                                                </span>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                            {activeCheckoutConfirmation && (
                                <div className="mb-2 rounded-sm border border-warning/40 bg-warning/10 px-2 py-2 text-xs text-warning">
                                    <div className="mb-1 flex items-center gap-2">
                                        <span className="min-w-0 flex-1 font-semibold">Detached HEAD checkout</span>
                                        <button
                                            type="button"
                                            className="cursor-pointer rounded-sm px-1.5 py-0.5 text-warning hover:bg-warning/15"
                                            onClick={() => setPendingCheckout(null)}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                    <div className="break-words">
                                        Checkout {activeCheckoutConfirmation.shorthash} without a branch. New commits
                                        will not be on a branch unless you create one.
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    className="cursor-pointer rounded-sm bg-accent/80 px-2 py-1.5 text-xs text-primary transition-colors hover:bg-accent"
                                    onClick={() =>
                                        fireAndForget(
                                            async () =>
                                                await showGitOutput("Commit Details", [
                                                    "--no-pager",
                                                    "show",
                                                    "--stat",
                                                    "--oneline",
                                                    selectedCommit.hash,
                                                ])
                                        )
                                    }
                                >
                                    Show
                                </button>
                                <button
                                    type="button"
                                    className={cn(
                                        "cursor-pointer rounded-sm px-2 py-1.5 text-xs text-primary transition-colors",
                                        activeCheckoutConfirmation
                                            ? "bg-warning/70 hover:bg-warning"
                                            : "bg-hoverbg hover:bg-hover"
                                    )}
                                    onClick={() =>
                                        activeCheckoutConfirmation
                                            ? confirmCheckoutCommit()
                                            : checkoutCommit(selectedCommit)
                                    }
                                >
                                    {activeCheckoutConfirmation ? "Confirm Checkout" : "Checkout"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            <GitPreviewPanel
                preview={preview}
                onClose={() => setPreview(EmptyPreview)}
                onOpenTerminal={openGitArgsInTerminal}
            />
        </aside>
    );
}
