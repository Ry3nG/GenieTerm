// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CommandAiClient, isCommandAiEngineReady, openCommandAiSettings } from "@/app/store/commandai";
import type { TermViewModel } from "@/app/view/term/term-model";
import { cn, fireAndForget, useAtomValueSafe } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import {
    describeCommandAiProblem,
    type CommandAiApplyAction,
    type CommandAiExchange,
    type CommandAiProposalView,
    type CommandAiSheetState,
} from "./command-composer";
import type { CommandRisk } from "./command-risk";
import type { TermWrap } from "./termwrap";

export type CommandAiSheetActions = {
    setInput: (input: string) => void;
    submit: () => void;
    cancel: () => void;
    close: () => void;
    select: (index: number) => void;
    move: (delta: number) => boolean;
    apply: (proposalId: string, action: CommandAiApplyAction) => void;
    cancelConfirm: () => void;
    retry: () => void;
    setIncludeOutput: (include: boolean) => void;
    toggleDisclosure: () => void;
    chooseEngine: (engine: string) => void;
    openSettings: () => void;
    copyText: (text: string) => void;
};

export type CommandAiSheetProps = {
    sheet: CommandAiSheetState;
    status: CommandAiStatus | null;
    contextLabel: string;
    isMac: boolean;
    runBlockedReason: (command: string) => string | null;
    actions: CommandAiSheetActions;
    now?: number;
    autoFocus?: boolean;
};

const ComposeExamples = [
    "find files larger than 100 MB here",
    "what is listening on port 3000",
    "compress this folder into a .tar.gz",
    "show my git commits from last week",
];

const SetupEngineIds = ["codex", "claude", "ollama"];

function modKey(isMac: boolean): string {
    return isMac ? "⌘" : "Ctrl+";
}

function engineLabel(status: CommandAiStatus | null): string {
    if (status?.engine == null) {
        return "";
    }
    return status.engines?.find((engine) => engine.id === status.engine)?.label ?? status.engine;
}

function lowerFirst(text: string): string {
    return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function joinReasons(reasons: string[]): string {
    const lowered = reasons.map(lowerFirst);
    if (lowered.length <= 1) {
        return lowered[0] ?? "";
    }
    return `${lowered.slice(0, -1).join(", ")} and ${lowered[lowered.length - 1]}`;
}

// Renders `inline code` spans in model-written text without interpreting anything else.
function InlineText({ text }: { text: string }) {
    const parts = text.split(/(`[^`\n]+`)/g);
    return (
        <>
            {parts.map((part, index) =>
                part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
                    <code
                        key={index}
                        className="rounded bg-white/[0.07] px-1 py-px font-mono text-[0.92em] text-primary"
                    >
                        {part.slice(1, -1)}
                    </code>
                ) : (
                    <React.Fragment key={index}>{part}</React.Fragment>
                )
            )}
        </>
    );
}

export function RiskBadge({ risk, hiddenChars }: { risk: CommandRisk; hiddenChars: boolean }) {
    if (hiddenChars) {
        return (
            <span className="shrink-0 rounded-full bg-error/15 px-2 py-0.5 text-[11px] font-medium text-[#ff7a66]">
                Hidden characters
            </span>
        );
    }
    if (risk.level === "safe") {
        return null;
    }
    const extra = risk.reasons.length - 1;
    return (
        <span
            title={risk.reasons.join("\n")}
            className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                risk.level === "danger" ? "bg-error/15 text-[#ff7a66]" : "bg-warning/[0.13] text-warning"
            )}
        >
            {risk.reasons[0]}
            {extra > 0 && <span className="opacity-70"> +{extra}</span>}
        </span>
    );
}

function SheetButton({
    children,
    onClick,
    primary,
    danger,
    disabled,
    title,
    hint,
}: {
    children: React.ReactNode;
    onClick: () => void;
    primary?: boolean;
    danger?: boolean;
    disabled?: boolean;
    title?: string;
    hint?: string;
}) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40",
                primary && "bg-accent/80 text-primary hover:bg-accent",
                danger && "bg-error/80 text-primary hover:bg-error",
                !primary && !danger && "bg-white/[0.06] text-secondary hover:bg-white/[0.1] hover:text-primary"
            )}
        >
            {children}
            {hint && <span className="text-[11px] font-normal opacity-60">{hint}</span>}
        </button>
    );
}

function ProposalRow({
    proposal,
    selected,
    confirming,
    isMac,
    runBlockedReason,
    onSelect,
    actions,
}: {
    proposal: CommandAiProposalView;
    selected: boolean;
    confirming: boolean;
    isMac: boolean;
    runBlockedReason: string | null;
    onSelect: () => void;
    actions: CommandAiSheetActions;
}) {
    const rowRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (selected) {
            rowRef.current?.scrollIntoView({ block: "nearest" });
        }
    }, [selected]);
    const mod = modKey(isMac);
    return (
        <div
            ref={rowRef}
            role="option"
            aria-selected={selected}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSelect}
            onDoubleClick={() => actions.apply(proposal.id, "insert")}
            className={cn(
                "relative rounded-lg px-3 py-2.5 transition-colors cursor-pointer",
                selected ? "bg-white/[0.07]" : "hover:bg-white/[0.035]"
            )}
        >
            {selected && <span className="absolute inset-y-2.5 left-0 w-[2px] rounded-full bg-accent" />}
            <div className="flex items-start gap-3 @max-[520px]/cai:flex-col @max-[520px]/cai:gap-1.5">
                <code className="min-w-0 flex-1 font-mono text-[12.5px] leading-5 break-words whitespace-pre-wrap text-primary select-text @max-[520px]/cai:w-full">
                    {proposal.command}
                </code>
                <RiskBadge risk={proposal.risk} hiddenChars={proposal.hiddenChars} />
            </div>
            {proposal.explanation && (
                <div className="mt-1 text-[12px] leading-[18px] text-secondary">
                    <InlineText text={proposal.explanation} />
                </div>
            )}
            {selected && !confirming && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <SheetButton primary hint="↵" onClick={() => actions.apply(proposal.id, "insert")}>
                        Insert
                    </SheetButton>
                    <SheetButton
                        hint={`${mod}↵`}
                        disabled={runBlockedReason != null}
                        title={runBlockedReason ?? "Run it now"}
                        onClick={() => actions.apply(proposal.id, "run")}
                    >
                        Run
                    </SheetButton>
                    <SheetButton title="Copy to the clipboard" onClick={() => actions.apply(proposal.id, "copy")}>
                        <i className="fa-regular fa-copy" aria-hidden="true" />
                        Copy
                    </SheetButton>
                </div>
            )}
            {confirming && (
                <div
                    role="alertdialog"
                    aria-label="Confirm run"
                    className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-error/30 bg-error/[0.09] px-3 py-2"
                >
                    <i className="fa-solid fa-triangle-exclamation text-[12px] text-[#ff7a66]" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-[12px] leading-[18px] text-primary">
                        {proposal.hiddenChars
                            ? "This command contains hidden characters, so it may not do what it shows."
                            : `This command ${joinReasons(proposal.risk.reasons)}.`}{" "}
                        Run it anyway?
                    </span>
                    <div className="flex items-center gap-1.5">
                        <SheetButton onClick={actions.cancelConfirm}>Cancel</SheetButton>
                        <SheetButton danger hint={`${mod}↵`} onClick={() => actions.apply(proposal.id, "run")}>
                            Run
                        </SheetButton>
                    </div>
                </div>
            )}
        </div>
    );
}

function LoadingView({
    engine,
    prompt,
    startedAt,
    now,
    onCancel,
}: {
    engine: string;
    prompt: string;
    startedAt: number;
    now: number;
    onCancel: () => void;
}) {
    const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    return (
        <div className="px-4 py-4" aria-live="polite">
            <div className="flex items-center gap-3">
                <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                    <span className="absolute inset-0 animate-ping rounded-full bg-accent/30" />
                    <span className="h-2 w-2 rounded-full bg-accent" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-primary">
                        Asking {engine || "the AI"}…
                        {seconds >= 2 && <span className="ml-2 text-[12px] text-muted tabular-nums">{seconds}s</span>}
                    </div>
                    {prompt && <div className="mt-0.5 truncate text-[12px] text-muted">{prompt}</div>}
                </div>
                <SheetButton hint="esc" onClick={onCancel}>
                    Cancel
                </SheetButton>
            </div>
            <div className="mt-4 space-y-2.5 pl-7">
                <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
            </div>
        </div>
    );
}

function CopyCommandPill({ command, onCopy }: { command: string; onCopy: (text: string) => void }) {
    const [copied, setCopied] = React.useState(false);
    return (
        <div className="mt-2.5 flex max-w-full items-center gap-2 rounded-md bg-black/25 py-1 pr-1 pl-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-primary">{command}</code>
            <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                    onCopy(command);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] text-secondary transition-colors hover:bg-white/10 hover:text-primary cursor-pointer"
            >
                <i className={cn("fa-solid", copied ? "fa-check" : "fa-copy")} aria-hidden="true" />
                {copied ? "Copied" : "Copy"}
            </button>
        </div>
    );
}

function ProblemView({ result, actions }: { result: CommandAiResult; actions: CommandAiSheetActions }) {
    const problem = describeCommandAiProblem(result);
    if (problem == null) {
        return null;
    }
    return (
        <div className="flex gap-3 px-4 py-4">
            <i className="fa-solid fa-circle-exclamation mt-0.5 text-[14px] text-warning" aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-primary">{problem.title}</div>
                {problem.detail && (
                    <div className="mt-0.5 text-[12px] leading-[18px] text-secondary">{problem.detail}</div>
                )}
                {problem.fixCommand && (
                    <>
                        <div className="mt-2.5 text-[12px] text-secondary">
                            Run this in a terminal on this computer:
                        </div>
                        <CopyCommandPill command={problem.fixCommand} onCopy={actions.copyText} />
                    </>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {problem.retry && (
                        <SheetButton primary onClick={actions.retry}>
                            Try Again
                        </SheetButton>
                    )}
                    {problem.openSettings && (
                        <SheetButton primary={!problem.retry} onClick={actions.openSettings}>
                            Open Settings
                        </SheetButton>
                    )}
                </div>
            </div>
        </div>
    );
}

function engineIcon(engine: CommandAiEngineInfo): string {
    if (engine.kind === "local") {
        return "fa-microchip";
    }
    if (engine.kind === "api") {
        return "fa-key";
    }
    return "fa-terminal";
}

function engineStatusLine(engine: CommandAiEngineInfo): string {
    if (isCommandAiEngineReady(engine)) {
        if (engine.kind === "local") {
            return engine.detail || "Running on this computer";
        }
        return engine.account ? `Signed in · ${engine.account}` : "Signed in";
    }
    return engine.detail || (engine.available ? "Not signed in" : "Not installed");
}

function SetupView({ status, actions }: { status: CommandAiStatus | null; actions: CommandAiSheetActions }) {
    const engines = (status?.engines ?? []).filter((engine) => SetupEngineIds.includes(engine.id));
    const fixable = engines.filter((engine) => !isCommandAiEngineReady(engine) && engine.fixcommand);
    return (
        <div className="px-4 py-4">
            <div className="text-[14px] font-semibold text-primary">Choose the AI that writes your commands</div>
            <div className="mt-1 max-w-[560px] text-[12px] leading-[18px] text-secondary">
                GenieTerm has no AI service of its own. It uses one you already have, and sends a request only when you
                ask.
            </div>
            {status == null ? (
                <div className="mt-4 flex items-center gap-2 text-[12px] text-muted">
                    <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                    Looking for AI tools on this computer…
                </div>
            ) : (
                <div className="mt-3.5 grid gap-2 @[560px]/cai:grid-cols-3">
                    {engines.map((engine) => {
                        const ready = isCommandAiEngineReady(engine);
                        return (
                            <button
                                key={engine.id}
                                type="button"
                                disabled={!ready}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => actions.chooseEngine(engine.id)}
                                className={cn(
                                    "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                                    ready
                                        ? "border-white/10 bg-white/[0.04] hover:border-accent/60 hover:bg-accent/10 cursor-pointer"
                                        : "border-white/[0.06] opacity-60"
                                )}
                            >
                                <i
                                    className={cn(
                                        "fa-solid mt-0.5 w-4 text-center text-[13px]",
                                        engineIcon(engine),
                                        ready ? "text-accent" : "text-muted"
                                    )}
                                    aria-hidden="true"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="flex text-[13px] font-medium text-primary">{engine.label}</span>
                                    <span className="inline-block w-full truncate text-[11.5px] text-secondary">
                                        {engineStatusLine(engine)}
                                    </span>
                                </span>
                                {ready && <span className="self-center text-[12px] font-medium text-accent">Use</span>}
                            </button>
                        );
                    })}
                </div>
            )}
            {fixable.length > 0 && fixable.length === engines.length && (
                <div className="mt-3 text-[12px] text-secondary">
                    To use {fixable[0].label}, run this in a terminal on this computer, then come back:
                    <CopyCommandPill command={fixable[0].fixcommand} onCopy={actions.copyText} />
                </div>
            )}
            <div className="mt-3.5 text-[12px] text-muted">
                Rather use an API key or your own server?{" "}
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={actions.openSettings}
                    className="text-accent hover:underline cursor-pointer"
                >
                    Open Settings
                </button>
            </div>
        </div>
    );
}

function DisclosureView({ sheet, actions }: { sheet: CommandAiSheetState; actions: CommandAiSheetActions }) {
    const disclosure = sheet.disclosure;
    const [showInstructions, setShowInstructions] = React.useState(false);
    if (disclosure.loading) {
        return (
            <div className="flex items-center gap-2 px-4 py-4 text-[12px] text-muted">
                <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                Preparing the request…
            </div>
        );
    }
    if (disclosure.error || disclosure.preview == null) {
        return <div className="px-4 py-4 text-[12px] text-secondary">{disclosure.error || "Nothing to show."}</div>;
    }
    const preview = disclosure.preview;
    return (
        <div className="px-4 py-3">
            <div className="flex items-start gap-2 text-[12px] leading-[18px] text-secondary">
                <i className="fa-solid fa-shield-halved mt-0.5 text-accent" aria-hidden="true" />
                <span>
                    {preview.destination ? `Goes to ${preview.destination}.` : "Nothing is sent yet."}{" "}
                    {preview.redactions > 0
                        ? `${preview.redactions} ${preview.redactions === 1 ? "secret was" : "secrets were"} replaced with [REDACTED].`
                        : "Keys, tokens and passwords are replaced with [REDACTED] before anything is sent."}
                </span>
            </div>
            <pre className="mt-2.5 max-h-60 overflow-auto rounded-md bg-black/30 p-3 font-mono text-[11.5px] leading-[17px] whitespace-pre-wrap text-secondary select-text">
                {preview.message}
            </pre>
            <div className="mt-2 flex items-center gap-3">
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setShowInstructions(!showInstructions)}
                    className="text-[12px] text-muted hover:text-primary cursor-pointer"
                >
                    <i
                        className={cn(
                            "fa-solid mr-1 text-[10px]",
                            showInstructions ? "fa-chevron-down" : "fa-chevron-right"
                        )}
                        aria-hidden="true"
                    />
                    Instructions sent with every request
                </button>
                <span className="flex-1" />
                <SheetButton onClick={actions.toggleDisclosure}>Done</SheetButton>
            </div>
            {showInstructions && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-black/30 p-3 font-mono text-[11px] leading-[16px] whitespace-pre-wrap text-muted select-text">
                    {preview.system}
                </pre>
            )}
        </div>
    );
}

function ResultView({
    exchange,
    sheet,
    isMac,
    runBlockedReason,
    actions,
}: {
    exchange: CommandAiExchange;
    sheet: CommandAiSheetState;
    isMac: boolean;
    runBlockedReason: (command: string) => string | null;
    actions: CommandAiSheetActions;
}) {
    if (describeCommandAiProblem(exchange.result) != null) {
        return <ProblemView result={exchange.result} actions={actions} />;
    }
    const summary = exchange.result.summary?.trim();
    return (
        <div className="px-1.5 py-1.5">
            {summary && (
                <div className="px-2.5 pt-1.5 pb-2 text-[13px] leading-5 whitespace-pre-wrap text-primary select-text">
                    <InlineText text={summary} />
                </div>
            )}
            {exchange.proposals.length > 0 && (
                <div role="listbox" aria-label="Proposed commands" className="space-y-0.5">
                    {exchange.proposals.map((proposal, index) => (
                        <ProposalRow
                            key={proposal.id}
                            proposal={proposal}
                            selected={index === sheet.selected}
                            confirming={sheet.confirmId === proposal.id}
                            isMac={isMac}
                            runBlockedReason={runBlockedReason(proposal.command)}
                            onSelect={() => actions.select(index)}
                            actions={actions}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function SheetHeader({
    sheet,
    status,
    actions,
}: {
    sheet: CommandAiSheetState;
    status: CommandAiStatus | null;
    actions: CommandAiSheetActions;
}) {
    const engine = engineLabel(status);
    const target = sheet.target;
    const trail = sheet.exchanges.map((exchange) => exchange.prompt).filter(Boolean);
    let title: React.ReactNode = <span className="text-[12px] font-semibold text-primary">Command AI</span>;
    if (sheet.task !== "compose") {
        title = (
            <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-[12px] font-semibold text-primary">
                    {sheet.task === "fix" ? "Fix" : "Explain"}
                </span>
                {target?.command ? (
                    <code className="min-w-0 truncate font-mono text-[12px] text-secondary">{target.command}</code>
                ) : (
                    sheet.selection && <span className="truncate text-[12px] text-secondary">the selected text</span>
                )}
                {sheet.task === "fix" && target?.exitCode != null && (
                    <span className="shrink-0 rounded bg-error/15 px-1.5 py-px font-mono text-[10.5px] text-[#ff7a66]">
                        exit {target.exitCode}
                    </span>
                )}
            </span>
        );
    } else if (trail.length > 0) {
        title = (
            <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
                <span className="truncate font-semibold text-primary">{trail[0]}</span>
                {trail.slice(1).map((step, index) => (
                    <React.Fragment key={index}>
                        <i className="fa-solid fa-chevron-right shrink-0 text-[8px] text-muted" aria-hidden="true" />
                        <span className="truncate text-secondary">{step}</span>
                    </React.Fragment>
                ))}
            </span>
        );
    }
    return (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] pr-1.5 pl-3.5">
            <i className="fa-solid fa-wand-magic-sparkles shrink-0 text-[12px] text-accent" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 items-center">{title}</div>
            {engine && (
                <button
                    type="button"
                    title="Change in Settings"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={actions.openSettings}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-white/[0.06] hover:text-primary cursor-pointer"
                >
                    {engine}
                </button>
            )}
            <button
                type="button"
                aria-label="Close"
                title="Close"
                onMouseDown={(e) => e.preventDefault()}
                onClick={actions.close}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-white/[0.08] hover:text-primary cursor-pointer"
            >
                <i className="fa-solid fa-xmark text-[12px]" aria-hidden="true" />
            </button>
        </div>
    );
}

function inputPlaceholder(sheet: CommandAiSheetState): string {
    if (sheet.exchanges.length === 0) {
        return sheet.task === "compose" ? "Describe what you want to do" : "Add a question or detail (optional)";
    }
    return sheet.task === "compose" ? "Refine it, like “only in src”" : "Ask a follow-up";
}

function SheetFooter({
    sheet,
    contextLabel,
    isMac,
    hasProposals,
    showDisclosure,
    actions,
}: {
    sheet: CommandAiSheetState;
    contextLabel: string;
    isMac: boolean;
    hasProposals: boolean;
    showDisclosure: boolean;
    actions: CommandAiSheetActions;
}) {
    const outputLines = sheet.target?.outputLines ?? 0;
    const mod = modKey(isMac);
    return (
        <div className="flex h-8 shrink-0 items-center gap-3 border-t border-white/[0.04] bg-black/[0.12] px-3.5 text-[11px] text-muted">
            <span className="min-w-0 truncate" title={contextLabel}>
                {contextLabel}
            </span>
            {sheet.target != null && outputLines > 0 && (
                <label className="flex shrink-0 items-center gap-1.5 hover:text-primary cursor-pointer">
                    <input
                        type="checkbox"
                        checked={sheet.includeOutput}
                        onChange={(e) => actions.setIncludeOutput(e.target.checked)}
                        className="h-3 w-3 accent-[var(--color-accent)] cursor-pointer"
                    />
                    Include output ({outputLines} {outputLines === 1 ? "line" : "lines"})
                </label>
            )}
            {sheet.selection && <span className="shrink-0">Selected text included</span>}
            <span className="flex-1" />
            {hasProposals && (
                <span className="hidden shrink-0 whitespace-nowrap @[600px]/cai:inline">
                    ↵ insert · {mod}↵ run · esc close
                </span>
            )}
            {showDisclosure && (
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={actions.toggleDisclosure}
                    className={cn(
                        "shrink-0 hover:text-primary cursor-pointer",
                        sheet.disclosure != null && "text-primary"
                    )}
                >
                    What’s sent
                </button>
            )}
        </div>
    );
}

export function CommandAiSheet({
    sheet,
    status,
    contextLabel,
    isMac,
    runBlockedReason,
    actions,
    now,
    autoFocus = true,
}: CommandAiSheetProps) {
    const inputRef = React.useRef<HTMLTextAreaElement>(null);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const [clock, setClock] = React.useState(Date.now());
    const pending = sheet.pending;
    React.useEffect(() => {
        if (pending == null || now != null) {
            return;
        }
        setClock(Date.now());
        const id = window.setInterval(() => setClock(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [pending?.requestId, now]);
    const needsSetup = status != null && !status.engine;
    // The setup screen has no input, so the sheet itself takes focus to keep Escape working.
    React.useEffect(() => {
        if (autoFocus) {
            (inputRef.current ?? rootRef.current)?.focus();
        }
    }, [autoFocus, needsSetup]);
    React.useLayoutEffect(() => {
        const el = inputRef.current;
        if (el == null) {
            return;
        }
        el.style.height = "0px";
        el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
    }, [sheet.input]);

    const lastExchange = sheet.exchanges[sheet.exchanges.length - 1];
    const proposals = pending == null && lastExchange != null ? lastExchange.proposals : [];
    const selected = proposals[sheet.selected];
    const canSend =
        pending == null && (sheet.input.trim() !== "" || (sheet.task !== "compose" && sheet.exchanges.length === 0));

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (sheet.confirmId) {
                actions.cancelConfirm();
            } else if (sheet.disclosure != null) {
                actions.toggleDisclosure();
            } else if (pending != null) {
                actions.cancel();
            } else {
                actions.close();
            }
            return;
        }
        if (e.target !== inputRef.current && e.target !== rootRef.current) {
            return;
        }
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && proposals.length > 0 && !sheet.input.includes("\n")) {
            e.preventDefault();
            actions.move(e.key === "ArrowDown" ? 1 : -1);
            return;
        }
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) {
            return;
        }
        e.preventDefault();
        if (mod) {
            if (selected != null) {
                actions.apply(selected.id, "run");
            }
            return;
        }
        if (sheet.input.trim() !== "" || selected == null) {
            if (canSend && !needsSetup) {
                actions.submit();
            }
            return;
        }
        actions.apply(selected.id, "insert");
    };

    let body: React.ReactNode = null;
    if (needsSetup) {
        body = <SetupView status={status} actions={actions} />;
    } else if (sheet.disclosure != null) {
        body = <DisclosureView sheet={sheet} actions={actions} />;
    } else if (pending != null) {
        body = (
            <LoadingView
                engine={engineLabel(status)}
                prompt={pending.prompt}
                startedAt={pending.startedAt}
                now={now ?? clock}
                onCancel={actions.cancel}
            />
        );
    } else if (lastExchange != null) {
        body = (
            <ResultView
                exchange={lastExchange}
                sheet={sheet}
                isMac={isMac}
                runBlockedReason={runBlockedReason}
                actions={actions}
            />
        );
    } else if (sheet.task === "compose" && sheet.input.trim() === "") {
        body = (
            <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-3">
                <span className="mr-1 text-[12px] text-muted">Try</span>
                {ComposeExamples.map((example) => (
                    <button
                        key={example}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => actions.setInput(example)}
                        className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[12px] text-secondary transition-colors hover:bg-white/[0.1] hover:text-primary cursor-pointer"
                    >
                        {example}
                    </button>
                ))}
            </div>
        );
    }

    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-label="Command AI"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="@container/cai outline-none flex max-h-[600px] min-h-0 w-full flex-col font-sans overflow-hidden rounded-xl border border-white/[0.09] bg-[#232325]/95 text-[13px] text-primary shadow-[0_18px_50px_rgba(0,0,0,0.5),0_0_0_0.5px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        >
            <SheetHeader sheet={sheet} status={status} actions={actions} />
            {body != null && <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>}
            {sheet.notice && (
                <div
                    className="flex items-center gap-2 border-t border-white/[0.04] px-3.5 py-2 text-[12px] text-secondary"
                    aria-live="polite"
                >
                    <i className="fa-solid fa-circle-check text-success" aria-hidden="true" />
                    {sheet.notice}
                </div>
            )}
            {!needsSetup && (
                <form
                    className="flex shrink-0 items-end gap-2 border-t border-white/[0.06] py-2 pr-2 pl-3.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (canSend) {
                            actions.submit();
                        }
                    }}
                >
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={sheet.input}
                        aria-label={inputPlaceholder(sheet)}
                        placeholder={inputPlaceholder(sheet)}
                        onChange={(e) => actions.setInput(e.target.value)}
                        spellCheck={false}
                        className="max-h-24 min-h-[28px] flex-1 resize-none bg-transparent py-[5px] text-[13.5px] leading-[18px] text-primary outline-none placeholder:text-muted"
                    />
                    <button
                        type="submit"
                        aria-label="Send"
                        title="Send"
                        disabled={!canSend}
                        onMouseDown={(e) => e.preventDefault()}
                        className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                            canSend
                                ? "bg-accent/80 text-primary hover:bg-accent cursor-pointer"
                                : "bg-white/[0.06] text-muted"
                        )}
                    >
                        <i className="fa-solid fa-arrow-up text-[12px]" aria-hidden="true" />
                    </button>
                </form>
            )}
            <SheetFooter
                sheet={sheet}
                contextLabel={contextLabel}
                isMac={isMac}
                hasProposals={proposals.length > 0}
                showDisclosure={!needsSetup}
                actions={actions}
            />
        </div>
    );
}

type TermCommandComposerProps = {
    model: TermViewModel;
    termWrap: TermWrap | null;
    contextLabel: string;
    isMac: boolean;
};

const TermCommandComposer = React.memo(({ model, termWrap, contextLabel, isMac }: TermCommandComposerProps) => {
    const commandAi = model.commandAi;
    const sheet = jotai.useAtomValue(commandAi.sheetAtom);
    const client = CommandAiClient.getInstance();
    const status = jotai.useAtomValue(client.statusAtom);
    const shellIntegrationStatus = useAtomValueSafe(termWrap?.shellIntegrationStatusAtom);
    const altScreenActive = useAtomValueSafe<boolean>(termWrap?.altScreenActiveAtom) ?? false;

    const runBlockedReason = React.useCallback(
        (command: string) => commandAi.getRunBlockedReason(command),
        [commandAi, shellIntegrationStatus, altScreenActive]
    );

    const actions = React.useMemo<CommandAiSheetActions>(
        () => ({
            setInput: (input) => commandAi.setInput(input),
            submit: () => fireAndForget(() => commandAi.submit()),
            cancel: () => commandAi.cancelPending(),
            close: () => commandAi.close(),
            select: (index) => commandAi.select(index),
            move: (delta) => commandAi.moveSelection(delta),
            apply: (id, action) => fireAndForget(() => commandAi.apply(id, action)),
            cancelConfirm: () => commandAi.cancelConfirm(),
            retry: () => fireAndForget(() => commandAi.retry()),
            setIncludeOutput: (include) => fireAndForget(() => commandAi.setIncludeOutput(include)),
            toggleDisclosure: () => fireAndForget(() => commandAi.toggleDisclosure()),
            chooseEngine: (engine) =>
                fireAndForget(async () => {
                    await client.setEngine(engine as any);
                    if (commandAi.canSubmit()) {
                        await commandAi.submit();
                    }
                }),
            openSettings: () => {
                commandAi.close();
                openCommandAiSettings();
            },
            copyText: (text) => fireAndForget(async () => navigator.clipboard?.writeText(text)),
        }),
        [client, commandAi]
    );

    if (sheet == null) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute inset-3 z-[calc(var(--zindex-termstickers)+5)] flex items-end justify-center">
            <div className="pointer-events-auto flex max-h-full w-full max-w-[720px] flex-col">
                <CommandAiSheet
                    sheet={sheet}
                    status={status}
                    contextLabel={contextLabel}
                    isMac={isMac}
                    runBlockedReason={runBlockedReason}
                    actions={actions}
                />
            </div>
        </div>
    );
});

TermCommandComposer.displayName = "TermCommandComposer";

export { TermCommandComposer };
