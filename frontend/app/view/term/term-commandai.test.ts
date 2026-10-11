// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CmdBlock } from "./cmdblocks";
import { TermCommandAiModel, type CommandAiHost, type CommandAiRunner } from "./term-commandai";

type Deferred = { request: CommandAiRequest; resolve: (result: CommandAiResult) => void };

function makeRunner(status: Partial<CommandAiStatus> = { engine: "claude", ready: true, enabled: true, engines: [] }) {
    const calls: Deferred[] = [];
    const runner: CommandAiRunner & { calls: Deferred[]; canceled: string[] } = {
        calls,
        canceled: [],
        run: (request) => new Promise<CommandAiResult>((resolve) => calls.push({ request, resolve })),
        preview: async (request) => ({ system: "sys", message: `msg:${request.prompt}`, destination: "Claude Code" }),
        cancel(requestId) {
            this.canceled.push(requestId);
        },
        loadStatus: async () => status as CommandAiStatus,
    };
    return runner;
}

function ok(request: CommandAiRequest, commands: string[], summary = ""): CommandAiResult {
    return {
        requestid: request.requestid,
        status: "ok",
        enginelabel: "Claude Code",
        summary,
        proposals: commands.map((command) => ({ command, explanation: "" })),
    };
}

type FakeTermWrap = {
    cmdBlocks: CmdBlock[];
    shellTypeAtom: jotai.PrimitiveAtom<string>;
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<string>;
    altScreenActiveAtom: jotai.PrimitiveAtom<boolean>;
    terminal: any;
    runCommand: ReturnType<typeof vi.fn>;
    insertCommand: ReturnType<typeof vi.fn>;
    hasBracketedPaste: () => boolean;
    scheduleCmdDecorationSync: () => void;
};

function makeTermWrap(): FakeTermWrap {
    return {
        cmdBlocks: [],
        shellTypeAtom: jotai.atom("zsh"),
        shellIntegrationStatusAtom: jotai.atom("ready"),
        altScreenActiveAtom: jotai.atom(false),
        terminal: null,
        runCommand: vi.fn(() => true),
        insertCommand: vi.fn(() => true),
        hasBracketedPaste: () => true,
        scheduleCmdDecorationSync: () => {},
    };
}

function makeModel(runner = makeRunner(), hostOverrides: Partial<CommandAiHost> = {}) {
    const termWrap = makeTermWrap();
    const host: CommandAiHost = {
        blockId: "block-1",
        getBlockMeta: () => ({ connection: "prod", "cmd:cwd": "/srv/app" }),
        getTermWrap: () => termWrap as any,
        isEnabled: () => true,
        giveFocus: vi.fn(),
        dismissCompletion: vi.fn(),
        suppressCompletionFor: vi.fn(),
        includeOutputByDefault: () => true,
        inlineSuggestionsEnabled: () => true,
        ...hostOverrides,
    };
    return { model: new TermCommandAiModel(host, runner), runner, termWrap, host };
}

const failedBlock = {
    id: 4,
    command: "npm run build",
    exitCode: 2,
    state: "done",
    startTs: 1,
    doneTs: 2,
} as CmdBlock;

async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TermCommandAiModel", () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, "clipboard", {
            value: { writeText: vi.fn(async () => {}) },
            configurable: true,
        });
    });

    it("composes, then refines with the earlier turn", async () => {
        const { model, runner } = makeModel();
        model.open({ prompt: "find big files" });
        const first = model.submit();
        expect(model.getSheet().pending?.prompt).toBe("find big files");
        expect(runner.calls[0].request).toMatchObject({
            task: "compose",
            prompt: "find big files",
            blockid: "block-1",
            context: { connection: "prod", cwd: "/srv/app", shell: "zsh" },
        });
        runner.calls[0].resolve(ok(runner.calls[0].request, ["find . -size +100M"]));
        await first;
        expect(model.getSheet().exchanges).toHaveLength(1);

        model.setInput("only in src");
        const second = model.submit();
        expect(runner.calls[1].request.previous).toEqual([
            { prompt: "find big files", commands: ["find . -size +100M"] },
        ]);
        runner.calls[1].resolve(ok(runner.calls[1].request, ["find src -size +100M"]));
        await second;
        expect(model.getLastExchange().proposals[0].command).toBe("find src -size +100M");
    });

    it("drops a result that arrives after the sheet closed", async () => {
        const { model, runner } = makeModel();
        model.open({ prompt: "list files" });
        const pending = model.submit();
        model.close();
        expect(runner.canceled).toHaveLength(1);
        runner.calls[0].resolve(ok(runner.calls[0].request, ["ls"]));
        await pending;
        expect(model.getSheet()).toBeNull();
    });

    it("restores the prompt when a request is canceled", async () => {
        const { model, runner } = makeModel();
        model.open({ prompt: "list files" });
        const pending = model.submit();
        model.cancelPending();
        runner.calls[0].resolve({ requestid: runner.calls[0].request.requestid, status: "canceled" });
        await pending;
        expect(model.getSheet()).toMatchObject({ input: "list files", exchanges: [] });
        expect(model.getSheet().pending).toBeUndefined();
    });

    it("sends the failed command, exit code and output for fix", async () => {
        const { model, runner, termWrap } = makeModel();
        model.open({ block: failedBlock, submit: false });
        model.getSheet().target.output = "error TS2304: Cannot find name 'x'.";
        model.getSheet().target.outputLines = 1;
        const pending = model.submit();
        expect(runner.calls[0].request).toMatchObject({
            task: "fix",
            prompt: "",
            context: { command: "npm run build", exitcode: 2, output: "error TS2304: Cannot find name 'x'." },
        });
        runner.calls[0].resolve(ok(runner.calls[0].request, ["npm install"], "A dependency is missing."));
        await pending;
        expect(model.getLastExchange().result.summary).toBe("A dependency is missing.");
    });

    it("asks again without output when output sharing is turned off", async () => {
        const { model, runner, termWrap } = makeModel();
        model.open({ block: failedBlock });
        model.getSheet().target.output = "secret-ish output";
        const first = model.submit();
        runner.calls[0].resolve(ok(runner.calls[0].request, ["npm ci"]));
        await first;
        const second = model.setIncludeOutput(false);
        expect(runner.calls[1].request.context.output).toBeUndefined();
        runner.calls[1].resolve(ok(runner.calls[1].request, ["npm ci"]));
        await second;
        expect(model.getSheet().exchanges).toHaveLength(1);
    });

    it("confirms before running a dangerous proposal and inserts safe ones directly", async () => {
        const { model, runner, termWrap } = makeModel();
        model.open({ prompt: "clean up" });
        const pending = model.submit();
        runner.calls[0].resolve(ok(runner.calls[0].request, ["rm -rf build", "ls build"]));
        await pending;
        const [danger, safe] = model.getLastExchange().proposals;

        await model.apply(danger.id, "run");
        expect(model.getSheet().confirmId).toBe(danger.id);
        expect(termWrap.runCommand).not.toHaveBeenCalled();
        await model.apply(danger.id, "run");
        expect(termWrap.runCommand).toHaveBeenCalledWith("rm -rf build");
        expect(model.getSheet()).toBeNull();

        model.open({ prompt: "clean up" });
        const again = model.submit();
        runner.calls[1].resolve(ok(runner.calls[1].request, ["ls build"]));
        await again;
        await model.apply(model.getLastExchange().proposals[0].id, "insert");
        expect(termWrap.insertCommand).toHaveBeenCalledWith("ls build");
        expect(safe.command).toBe("ls build");
    });

    it("copies instead of inserting while a command is running", async () => {
        const { model, runner, termWrap } = makeModel();
        globalStore.set(termWrap.shellIntegrationStatusAtom, "running-command");
        model.open({ prompt: "list" });
        const pending = model.submit();
        runner.calls[0].resolve(ok(runner.calls[0].request, ["ls"]));
        await pending;
        await model.apply(model.getLastExchange().proposals[0].id, "insert");
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ls");
        expect(termWrap.insertCommand).not.toHaveBeenCalled();
        expect(model.getSheet().notice).toContain("Copied");
    });

    it("does not open when Command AI is off", () => {
        const { model } = makeModel(makeRunner(), { isEnabled: () => false });
        expect(model.open({ prompt: "x" })).toBe(false);
        expect(model.getSheet()).toBeNull();
    });

    it("previews the request it would send", async () => {
        const { model } = makeModel();
        model.open({ prompt: "" });
        model.setInput("list files");
        await model.toggleDisclosure();
        expect(model.getSheet().disclosure).toMatchObject({ loading: false, preview: { message: "msg:list files" } });
        await model.toggleDisclosure();
        expect(model.getSheet().disclosure).toBeUndefined();
    });

    it("suggests inline only after an engine is chosen", async () => {
        const unconfigured = makeModel(makeRunner({ engine: "", ready: false, enabled: true, engines: [] }));
        const block = { ...failedBlock, id: 9, command: "show disk usage", exitCode: 127 } as CmdBlock;
        await unconfigured.model.generateInline("show disk usage", block);
        expect(unconfigured.runner.calls).toHaveLength(0);
        expect(globalStore.get(unconfigured.model.inlineStatesAtom)).toEqual({});

        const { model, runner } = makeModel();
        const pending = model.generateInline("show disk usage", block);
        await flush();
        runner.calls[0].resolve(ok(runner.calls[0].request, ["df -h"]));
        await pending;
        expect(model.getInlineState(block)).toMatchObject({ status: "ready", proposal: { command: "df -h" } });
    });

    it("keeps only the newest inline result for a block", async () => {
        const { model, runner } = makeModel();
        const block = { ...failedBlock, id: 10, command: "show disk usage", exitCode: 127 } as CmdBlock;
        const first = model.generateInline("show disk usage", block);
        await flush();
        const second = model.generateInline("show disk usage please", block);
        await flush();
        runner.calls[1].resolve(ok(runner.calls[1].request, ["df -h"]));
        runner.calls[0].resolve(ok(runner.calls[0].request, ["echo stale"]));
        await Promise.all([first, second]);
        expect(model.getInlineState(block)).toMatchObject({ proposal: { command: "df -h" } });
    });

    it("ignores automatic inline requests when inline suggestions are off", async () => {
        const { model, runner } = makeModel(makeRunner(), { inlineSuggestionsEnabled: () => false });
        model.requestInline("show disk usage", failedBlock, { auto: true });
        await flush();
        expect(runner.calls).toHaveLength(0);
    });

    it("asks again after an engine is chosen on the setup screen", async () => {
        const { model, runner } = makeModel();
        model.open({ block: failedBlock, submit: false });
        const first = model.submit();
        runner.calls[0].resolve({ requestid: runner.calls[0].request.requestid, status: "notconfigured" });
        await first;
        const resumed = model.resumeAfterSetup();
        expect(runner.calls).toHaveLength(2);
        expect(runner.calls[1].request.task).toBe("fix");
        runner.calls[1].resolve(ok(runner.calls[1].request, ["npm install"]));
        await resumed;
        expect(model.getSheet().exchanges).toHaveLength(1);
        expect(model.getLastExchange().result.status).toBe("ok");
    });

    it("previews the request that is in flight", async () => {
        const { model } = makeModel();
        model.open({ prompt: "list files" });
        void model.submit();
        await model.toggleDisclosure();
        expect(model.getSheet().disclosure.preview.message).toBe("msg:list files");
    });

    it("does not send an inline request that was dismissed while status loaded", async () => {
        let resolveStatus: (status: CommandAiStatus) => void;
        const runner = makeRunner();
        runner.loadStatus = () => new Promise((resolve) => (resolveStatus = resolve));
        const { model } = makeModel(runner);
        const block = { ...failedBlock, id: 11, command: "show disk usage", exitCode: 127 } as CmdBlock;
        const pending = model.generateInline("show disk usage", block);
        model.dismissInline();
        resolveStatus({ engine: "claude", ready: true, enabled: true, engines: [] });
        await pending;
        expect(runner.calls).toHaveLength(0);
        expect(model.getInlineState(block)).toBeUndefined();
    });
});
