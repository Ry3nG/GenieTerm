// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { CommandAiClient, makeCommandAiRequestId } from "@/app/store/commandai";
import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { getCommandRunBlockedReason } from "./cmdblockdisplay";
import { getBlockOutputText, type CmdBlock } from "./cmdblocks";
import {
    buildCommandAiContext,
    getBlockAiTask,
    getCommandAiApplyMode,
    makeCommandAiTarget,
    makePreviousTurns,
    makeProposalViews,
    type CommandAiApplyAction,
    type CommandAiExchange,
    type CommandAiSheetState,
    type CommandAiTask,
    type CommandInlineAIAction,
    type CommandInlineAIRequestOptions,
    type CommandInlineAIState,
} from "./command-composer";
import type { TermWrap } from "./termwrap";

export type CommandAiRunner = {
    run(request: CommandAiRequest): Promise<CommandAiResult>;
    preview(request: CommandAiRequest): Promise<CommandAiPreview>;
    cancel(requestId: string): void;
    loadStatus(refresh?: boolean): Promise<CommandAiStatus>;
};

export type CommandAiHost = {
    blockId: string;
    getBlockMeta(): MetaType;
    getTermWrap(): TermWrap | null;
    isEnabled(): boolean;
    giveFocus(): void;
    dismissCompletion(): void;
    suppressCompletionFor(command: string): void;
    includeOutputByDefault(): boolean;
    inlineSuggestionsEnabled(): boolean;
};

export type CommandAiOpenOptions = {
    task?: CommandAiTask;
    prompt?: string;
    block?: CmdBlock;
    selection?: string;
    submit?: boolean;
};

const NoticeMs = 2400;
const MaxSelectionChars = 4000;

function errorResult(requestId: string, error: unknown): CommandAiResult {
    return {
        requestid: requestId,
        status: "failed",
        statusdetail: error instanceof Error ? error.message : String(error),
    };
}

export class TermCommandAiModel {
    host: CommandAiHost;
    runner: CommandAiRunner;
    sheetAtom = jotai.atom(null) as jotai.PrimitiveAtom<CommandAiSheetState>;
    inlineStatesAtom = jotai.atom({}) as jotai.PrimitiveAtom<Record<number, CommandInlineAIState>>;
    noticeTimer: ReturnType<typeof setTimeout> = null;
    inlineEpoch = 0;

    constructor(host: CommandAiHost, runner?: CommandAiRunner) {
        this.host = host;
        this.runner = runner ?? CommandAiClient.getInstance();
    }

    getSheet(): CommandAiSheetState {
        return globalStore.get(this.sheetAtom);
    }

    isOpen(): boolean {
        return this.getSheet() != null;
    }

    private setSheet(update: Partial<CommandAiSheetState>) {
        const sheet = this.getSheet();
        if (sheet == null) {
            return;
        }
        globalStore.set(this.sheetAtom, { ...sheet, ...update });
    }

    open(options: CommandAiOpenOptions = {}): boolean {
        if (!this.host.isEnabled()) {
            return false;
        }
        this.host.dismissCompletion();
        this.cancelPending();
        const termWrap = this.host.getTermWrap();
        const block = options.block;
        const task: CommandAiTask = options.task ?? (block != null ? (getBlockAiTask(block) ?? "compose") : "compose");
        const target =
            block != null && task !== "compose"
                ? makeCommandAiTarget(
                      block,
                      termWrap?.terminal != null ? getBlockOutputText(block, termWrap.terminal) : ""
                  )
                : undefined;
        const selection = options.selection?.trim().slice(0, MaxSelectionChars) || undefined;
        globalStore.set(this.sheetAtom, {
            task,
            input: options.prompt ?? "",
            exchanges: [],
            selected: 0,
            target,
            selection,
            includeOutput: this.host.includeOutputByDefault(),
        });
        this.runner.loadStatus().catch((e) => console.error("command ai status failed", e));
        if (options.submit) {
            fireAndForget(() => this.submit());
        }
        return true;
    }

    close() {
        if (!this.isOpen()) {
            return;
        }
        this.cancelPending();
        globalStore.set(this.sheetAtom, null);
        this.host.giveFocus();
    }

    setInput(input: string) {
        this.setSheet({ input });
    }

    cancelPending() {
        const pending = this.getSheet()?.pending;
        if (pending == null) {
            return;
        }
        this.runner.cancel(pending.requestId);
        this.setSheet({ pending: undefined, input: pending.prompt });
    }

    buildRequest(sheet: CommandAiSheetState, prompt: string, requestId: string): CommandAiRequest {
        const termWrap = this.host.getTermWrap();
        const target = sheet.target;
        const context = buildCommandAiContext({
            blockMeta: this.host.getBlockMeta(),
            recentBlocks: (termWrap?.cmdBlocks ?? []).filter((block) => block.id !== target?.blockId),
            shellType: termWrap != null ? globalStore.get(termWrap.shellTypeAtom) : undefined,
        });
        if (target != null) {
            context.command = target.command;
            if (target.exitCode != null) {
                context.exitcode = target.exitCode;
            }
            if (sheet.includeOutput && target.output) {
                context.output = target.output;
            }
        }
        if (sheet.selection) {
            context.selection = sheet.selection;
        }
        const okExchanges = sheet.exchanges.filter((exchange) => exchange.result.status === "ok");
        const request: CommandAiRequest = {
            requestid: requestId,
            task: sheet.task,
            prompt,
            blockid: this.host.blockId,
            context,
        };
        if (okExchanges.length > 0) {
            request.previous = makePreviousTurns(okExchanges);
        }
        return request;
    }

    canSubmit(sheet: CommandAiSheetState = this.getSheet()): boolean {
        if (sheet == null || sheet.pending != null) {
            return false;
        }
        if (sheet.input.trim() !== "") {
            return true;
        }
        return sheet.task !== "compose" && sheet.exchanges.length === 0;
    }

    async submit(): Promise<void> {
        const sheet = this.getSheet();
        if (!this.canSubmit(sheet)) {
            return;
        }
        const lastExchange = sheet.exchanges[sheet.exchanges.length - 1];
        const exchanges =
            lastExchange != null && lastExchange.result.status !== "ok"
                ? sheet.exchanges.slice(0, -1)
                : sheet.exchanges;
        await this.runPrompt(sheet.input.trim(), { ...sheet, exchanges });
    }

    // Called after the person picks an engine on the setup screen. A request that already
    // came back "not configured" (Fix and Explain send one straight away) is asked again.
    async resumeAfterSetup(): Promise<void> {
        const sheet = this.getSheet();
        if (sheet == null || sheet.pending != null) {
            return;
        }
        const last = sheet.exchanges[sheet.exchanges.length - 1];
        if (last != null && last.result.status !== "ok") {
            await this.retry();
            return;
        }
        if (this.canSubmit(sheet)) {
            await this.submit();
        }
    }

    async retry(): Promise<void> {
        const sheet = this.getSheet();
        if (sheet == null || sheet.pending != null) {
            return;
        }
        const last = sheet.exchanges[sheet.exchanges.length - 1];
        if (last == null) {
            await this.submit();
            return;
        }
        await this.runPrompt(last.prompt, { ...sheet, exchanges: sheet.exchanges.slice(0, -1) });
    }

    async setIncludeOutput(includeOutput: boolean): Promise<void> {
        const sheet = this.getSheet();
        if (sheet == null || sheet.includeOutput === includeOutput) {
            return;
        }
        this.setSheet({ includeOutput, disclosure: undefined });
        if (sheet.pending != null || sheet.exchanges.length !== 1) {
            return;
        }
        // The first answer was based on the output (or its absence); ask again so the
        // answer matches what is now being shared.
        await this.runPrompt(sheet.exchanges[0].prompt, { ...this.getSheet(), exchanges: [] });
    }

    private async runPrompt(prompt: string, base: CommandAiSheetState): Promise<void> {
        const requestId = makeCommandAiRequestId();
        const request = this.buildRequest(base, prompt, requestId);
        globalStore.set(this.sheetAtom, {
            ...base,
            input: "",
            pending: { requestId, prompt, startedAt: Date.now() },
            confirmId: undefined,
            disclosure: undefined,
            notice: undefined,
        });
        let result: CommandAiResult;
        try {
            result = await this.runner.run(request);
        } catch (e) {
            console.error("command ai request failed", e);
            result = errorResult(requestId, e);
        }
        const current = this.getSheet();
        if (current == null || current.pending?.requestId !== requestId) {
            return;
        }
        if (result?.status === "canceled") {
            this.setSheet({ pending: undefined, input: prompt });
            return;
        }
        const exchange: CommandAiExchange = { prompt, result, proposals: makeProposalViews(result) };
        this.setSheet({ pending: undefined, exchanges: [...current.exchanges, exchange], selected: 0 });
    }

    getLastExchange(): CommandAiExchange | null {
        const exchanges = this.getSheet()?.exchanges ?? [];
        return exchanges[exchanges.length - 1] ?? null;
    }

    select(index: number) {
        const count = this.getLastExchange()?.proposals.length ?? 0;
        if (count === 0) {
            return;
        }
        const selected = Math.max(0, Math.min(count - 1, index));
        this.setSheet({ selected, confirmId: undefined });
    }

    moveSelection(delta: number): boolean {
        const sheet = this.getSheet();
        const count = this.getLastExchange()?.proposals.length ?? 0;
        if (sheet == null || count === 0) {
            return false;
        }
        this.select((sheet.selected + delta + count) % count);
        return true;
    }

    cancelConfirm() {
        this.setSheet({ confirmId: undefined });
    }

    showNotice(notice: string) {
        this.setSheet({ notice });
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => {
            if (this.getSheet()?.notice === notice) {
                this.setSheet({ notice: undefined });
            }
        }, NoticeMs);
    }

    getRunBlockedReason(command: string): string | null {
        const termWrap = this.host.getTermWrap();
        if (termWrap == null) {
            return "The terminal isn't ready";
        }
        return getCommandRunBlockedReason(command, {
            shellIntegrationStatus: globalStore.get(termWrap.shellIntegrationStatusAtom),
            altScreenActive: globalStore.get(termWrap.altScreenActiveAtom),
        });
    }

    async apply(proposalId: string, action: CommandAiApplyAction): Promise<void> {
        const sheet = this.getSheet();
        const proposal = this.getLastExchange()?.proposals.find((p) => p.id === proposalId);
        if (sheet == null || proposal == null) {
            return;
        }
        const termWrap = this.host.getTermWrap();
        const mode = getCommandAiApplyMode(proposal, action, {
            confirmed: sheet.confirmId === proposal.id,
            shellIntegrationStatus: termWrap != null ? globalStore.get(termWrap.shellIntegrationStatusAtom) : undefined,
            bracketedPaste: termWrap?.hasBracketedPaste() ?? false,
        });
        if (mode === "confirm") {
            this.setSheet({ confirmId: proposal.id });
            return;
        }
        if (mode === "copy") {
            await navigator.clipboard?.writeText(proposal.command);
            this.showNotice(
                action === "copy" ? "Copied" : "Copied — the terminal is busy, so paste it when it's ready"
            );
            return;
        }
        if (mode === "run") {
            const blocked = this.getRunBlockedReason(proposal.command);
            if (blocked != null || !termWrap.runCommand(proposal.command)) {
                this.setSheet({ confirmId: undefined });
                this.showNotice(blocked ?? "The terminal isn't ready");
                return;
            }
            globalStore.set(this.sheetAtom, null);
            return;
        }
        this.host.suppressCompletionFor(proposal.command);
        if (termWrap == null || !termWrap.insertCommand(proposal.command)) {
            await navigator.clipboard?.writeText(proposal.command);
            this.showNotice("Copied — the terminal can't take input right now");
            return;
        }
        globalStore.set(this.sheetAtom, null);
    }

    async toggleDisclosure(): Promise<void> {
        const sheet = this.getSheet();
        if (sheet == null) {
            return;
        }
        if (sheet.disclosure != null) {
            this.setSheet({ disclosure: undefined });
            return;
        }
        // Show what the request in flight (or the last one) sent; text typed since then is
        // what the next request would send.
        const last = sheet.exchanges[sheet.exchanges.length - 1];
        const typed = sheet.input.trim();
        let prompt = typed;
        let base = sheet;
        if (!typed && sheet.pending != null) {
            prompt = sheet.pending.prompt;
        } else if (!typed && last != null) {
            prompt = last.prompt;
            base = { ...sheet, exchanges: sheet.exchanges.slice(0, -1) };
        }
        const request = this.buildRequest(base, prompt, "preview");
        this.setSheet({ disclosure: { loading: true } });
        try {
            const preview = await this.runner.preview(request);
            if (this.getSheet()?.disclosure?.loading) {
                this.setSheet({ disclosure: { loading: false, preview } });
            }
        } catch (e) {
            if (this.getSheet()?.disclosure?.loading) {
                this.setSheet({
                    disclosure: { loading: false, error: e instanceof Error ? e.message : String(e) },
                });
            }
        }
    }

    getInlineState(block: CmdBlock): CommandInlineAIState {
        return globalStore.get(this.inlineStatesAtom)[block.id];
    }

    setInlineState(block: CmdBlock, state: CommandInlineAIState) {
        const states = globalStore.get(this.inlineStatesAtom);
        globalStore.set(this.inlineStatesAtom, { ...states, [block.id]: state });
        this.host.getTermWrap()?.scheduleCmdDecorationSync();
    }

    clearInlineState(block: CmdBlock) {
        const states = globalStore.get(this.inlineStatesAtom);
        if (states[block.id] == null) {
            return;
        }
        const next = { ...states };
        delete next[block.id];
        globalStore.set(this.inlineStatesAtom, next);
        this.host.getTermWrap()?.scheduleCmdDecorationSync();
    }

    dismissInline() {
        this.inlineEpoch++;
        const states = globalStore.get(this.inlineStatesAtom);
        for (const state of Object.values(states)) {
            if (state.status === "loading" && state.requestId) {
                this.runner.cancel(state.requestId);
            }
        }
        if (Object.keys(states).length === 0) {
            return;
        }
        globalStore.set(this.inlineStatesAtom, {});
        this.host.getTermWrap()?.scheduleCmdDecorationSync();
    }

    requestInline(prompt: string, block: CmdBlock, options?: CommandInlineAIRequestOptions) {
        if (!this.host.isEnabled()) {
            return;
        }
        const trimmed = prompt.trim();
        if (!trimmed) {
            return;
        }
        if (options?.auto) {
            if (!this.host.inlineSuggestionsEnabled()) {
                return;
            }
            fireAndForget(() => this.generateInline(trimmed, block));
            return;
        }
        this.open({ block, submit: true });
    }

    async generateInline(prompt: string, block: CmdBlock): Promise<void> {
        const trimmed = prompt.trim();
        if (!this.host.isEnabled() || !trimmed) {
            this.clearInlineState(block);
            return;
        }
        const epoch = this.inlineEpoch;
        const status = await this.runner.loadStatus().catch((): CommandAiStatus => null);
        // Typing a request at the prompt only gets an automatic answer once an engine has
        // been chosen; nothing is sent before that. Typing again while the status loads
        // dismisses the suggestion before it exists, so the epoch is checked too.
        if (status == null || !status.engine || !status.ready || epoch !== this.inlineEpoch) {
            return;
        }
        const requestId = makeCommandAiRequestId();
        const isCurrent = () => this.getInlineState(block)?.requestId === requestId;
        this.setInlineState(block, { prompt: trimmed, status: "loading", requestId });
        const termWrap = this.host.getTermWrap();
        const context = buildCommandAiContext({
            blockMeta: this.host.getBlockMeta(),
            recentBlocks: (termWrap?.cmdBlocks ?? []).filter((b) => b.id !== block.id),
            shellType: termWrap != null ? globalStore.get(termWrap.shellTypeAtom) : undefined,
        });
        let result: CommandAiResult;
        try {
            result = await this.runner.run({
                requestid: requestId,
                task: "compose",
                prompt: trimmed,
                blockid: this.host.blockId,
                context,
            });
        } catch (e) {
            console.error("inline command ai failed", e);
            result = errorResult(requestId, e);
        }
        if (!isCurrent()) {
            return;
        }
        if (result.status === "canceled") {
            this.clearInlineState(block);
            return;
        }
        const proposal = makeProposalViews(result)[0];
        this.setInlineState(block, {
            prompt: trimmed,
            status: proposal != null ? "ready" : "error",
            proposal,
            result,
            requestId,
        });
    }

    handleInlineAction(block: CmdBlock, action: CommandInlineAIAction) {
        const state = this.getInlineState(block);
        if (action === "dismiss") {
            if (state?.status === "loading" && state.requestId) {
                this.runner.cancel(state.requestId);
            }
            this.clearInlineState(block);
            return;
        }
        if (action === "open") {
            const prompt = state?.prompt || block.command || "";
            this.clearInlineState(block);
            this.open({ task: "compose", prompt, submit: true });
            return;
        }
        fireAndForget(() => this.applyInline(block, action));
    }

    async applyInline(block: CmdBlock, action: "insert" | "run"): Promise<void> {
        const state = this.getInlineState(block);
        const proposal = state?.proposal;
        if (proposal == null) {
            return;
        }
        const termWrap = this.host.getTermWrap();
        const mode = getCommandAiApplyMode(proposal, action, {
            confirmed: state.confirmAction === action,
            shellIntegrationStatus: termWrap != null ? globalStore.get(termWrap.shellIntegrationStatusAtom) : undefined,
            bracketedPaste: termWrap?.hasBracketedPaste() ?? false,
        });
        if (mode === "confirm") {
            this.setInlineState(block, { ...state, confirmAction: action });
            return;
        }
        if (mode === "copy") {
            await navigator.clipboard?.writeText(proposal.command);
            this.clearInlineState(block);
            return;
        }
        const applied =
            mode === "run" ? termWrap?.runCommand(proposal.command) : termWrap?.insertCommand(proposal.command);
        if (!applied) {
            return;
        }
        this.clearInlineState(block);
        this.host.giveFocus();
    }
}
