// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import type { CmdBlock } from "./cmdblocks";
import {
    buildCommandAiContext,
    CommandComposerActionId,
    CommandComposerDefaultBinding,
    describeCommandAiProblem,
    getBlockAiTask,
    getCommandAiApplyMode,
    getInlineAICommandPrompt,
    isCommandComposerEnabled,
    isLikelyNaturalLanguageCommand,
    makeCommandAiTarget,
    makePreviousTurns,
    makeProposalViews,
    shouldAutoComposeInlineAI,
    tailLines,
} from "./command-composer";

function makeBlock(command: string, cwd = "/repo", exitCode = 0): CmdBlock {
    return {
        id: 1,
        startMarker: { line: 1, dispose: () => {} } as any,
        endMarker: null,
        command,
        exitCode,
        state: "done",
        startTs: 100,
        doneTs: 200,
        cwd,
    };
}

function result(commands: string[], extra: Partial<CommandAiResult> = {}): CommandAiResult {
    return {
        requestid: "r1",
        status: "ok",
        proposals: commands.map((command) => ({ command, explanation: `does ${command}` })),
        ...extra,
    };
}

describe("command-composer", () => {
    it("defines the feature flag and default binding", () => {
        expect(CommandComposerActionId).toBe("term:command-composer");
        expect(CommandComposerDefaultBinding).toBe("Cmd:Shift:Space");
        expect(isCommandComposerEnabled({})).toBe(true);
        expect(isCommandComposerEnabled({ "term:commandcomposer": false })).toBe(false);
    });

    it("builds context from block metadata and recent command blocks", () => {
        const context = buildCommandAiContext({
            blockMeta: { connection: "prod", "cmd:cwd": "/srv/app" },
            shellType: "zsh",
            recentBlocks: [makeBlock("npm test"), makeBlock("npm test"), makeBlock("git status --short", "/srv/app")],
        });
        expect(context).toEqual({
            connection: "prod",
            cwd: "/srv/app",
            shell: "zsh",
            recentcommands: ["npm test", "git status --short"],
        });
    });

    it("leaves shell and cwd for the server to fill when they are unknown", () => {
        const context = buildCommandAiContext({ shellType: "unknown", recentBlocks: [] });
        expect(context.shell).toBeUndefined();
        expect(context.cwd).toBe("");
    });

    it("keeps the last eight recent commands", () => {
        const blocks = Array.from({ length: 12 }, (_, i) => makeBlock(`echo ${i}`));
        expect(buildCommandAiContext({ recentBlocks: blocks }).recentcommands).toEqual(
            Array.from({ length: 8 }, (_, i) => `echo ${i + 4}`)
        );
    });

    it("turns results into deduplicated proposals with local risk", () => {
        const views = makeProposalViews(result(["ls -la", "ls -la", "  rm -rf build  ", "", "du -sh", "df -h"]));
        expect(views.map((view) => view.command)).toEqual(["ls -la", "rm -rf build", "du -sh"]);
        expect(views[0].risk.level).toBe("safe");
        expect(views[1].risk).toMatchObject({ level: "danger", reasons: ["Deletes files"] });
        expect(new Set(views.map((view) => view.id)).size).toBe(3);
    });

    it("flags hidden characters in proposals", () => {
        const [view] = makeProposalViews(result(["r​m -rf build"]));
        expect(view.hiddenChars).toBe(true);
    });

    it("inserts without confirmation but asks before running dangerous commands", () => {
        const [safe, danger] = makeProposalViews(result(["ls", "sudo rm -rf /tmp/x"]));
        const ready = { confirmed: false, shellIntegrationStatus: "ready" as const, bracketedPaste: true };
        expect(getCommandAiApplyMode(safe, "run", ready)).toBe("run");
        expect(getCommandAiApplyMode(danger, "insert", ready)).toBe("insert");
        expect(getCommandAiApplyMode(danger, "run", ready)).toBe("confirm");
        expect(getCommandAiApplyMode(danger, "run", { ...ready, confirmed: true })).toBe("run");
        expect(getCommandAiApplyMode(safe, "copy", ready)).toBe("copy");
    });

    it("copies while the shell is busy or when a multi-line insert would run lines", () => {
        const [multi] = makeProposalViews(result(["cd /tmp\nls"]));
        expect(
            getCommandAiApplyMode(multi, "insert", {
                confirmed: false,
                shellIntegrationStatus: "ready",
                bracketedPaste: false,
            })
        ).toBe("copy");
        expect(
            getCommandAiApplyMode(multi, "insert", {
                confirmed: false,
                shellIntegrationStatus: "ready",
                bracketedPaste: true,
            })
        ).toBe("insert");
        expect(
            getCommandAiApplyMode(multi, "run", { confirmed: true, shellIntegrationStatus: "running-command" })
        ).toBe("copy");
    });

    it("picks fix for failed blocks and explain for finished ones", () => {
        expect(getBlockAiTask(makeBlock("npm run build", "/repo", 1))).toBe("fix");
        expect(getBlockAiTask(makeBlock("ls", "/repo", 0))).toBe("explain");
        expect(getBlockAiTask(makeBlock("sleep 100", "/repo", 130))).toBe("explain");
        expect(getBlockAiTask({ ...makeBlock("make"), state: "running", exitCode: null })).toBeNull();
    });

    it("keeps only the tail of a block's output", () => {
        const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n") + "\n\n";
        const tail = tailLines(output);
        expect(tail.lines).toBe(120);
        expect(tail.text.startsWith("line 80\n")).toBe(true);
        expect(tailLines("")).toEqual({ text: "", lines: 0 });
        expect(makeCommandAiTarget(makeBlock("npm test", "/repo", 1), "FAIL x\n")).toEqual({
            blockId: 1,
            command: "npm test",
            exitCode: 1,
            output: "FAIL x",
            outputLines: 1,
        });
    });

    it("sends earlier turns for refinement", () => {
        const exchanges = [
            { prompt: "find big files", result: result(["find . -size +100M"]), proposals: [] as any[] },
        ];
        exchanges[0].proposals = makeProposalViews(exchanges[0].result);
        expect(makePreviousTurns(exchanges)).toEqual([{ prompt: "find big files", commands: ["find . -size +100M"] }]);
    });

    it("explains engine problems in plain words", () => {
        expect(describeCommandAiProblem(result(["ls"]))).toBeNull();
        expect(
            describeCommandAiProblem({
                requestid: "r",
                status: "signedout",
                enginelabel: "Codex",
                fixcommand: "codex login",
            })
        ).toMatchObject({ title: "Sign in to Codex", fixCommand: "codex login", retry: true });
        expect(describeCommandAiProblem({ requestid: "r", status: "notconfigured" })).toMatchObject({
            openSettings: true,
        });
        expect(
            describeCommandAiProblem({ requestid: "r", status: "timeout", enginelabel: "Claude Code" })
        ).toMatchObject({
            title: "Claude Code took too long",
        });
        expect(describeCommandAiProblem({ requestid: "r", status: "canceled" })).toBeNull();
    });

    it("offers inline AI for failed commands and auto-composes only natural language failures", () => {
        const naturalLanguageFailure = { ...makeBlock("help me check disk usage."), exitCode: 127 };
        const ordinaryFailure = { ...makeBlock("grep TODO missing-file"), exitCode: 2 };
        const shellCommandTypo = { ...makeBlock("git stauts"), exitCode: 1 };

        expect(getInlineAICommandPrompt(naturalLanguageFailure)).toBe("help me check disk usage.");
        expect(shouldAutoComposeInlineAI(naturalLanguageFailure)).toBe(true);
        expect(getInlineAICommandPrompt(ordinaryFailure)).toBe("grep TODO missing-file");
        expect(shouldAutoComposeInlineAI(ordinaryFailure)).toBe(false);
        expect(shouldAutoComposeInlineAI(shellCommandTypo)).toBe(false);
        expect(getInlineAICommandPrompt(makeBlock("ls -la"))).toBe("");
    });

    it("auto-composes inline AI for Chinese natural language failures", () => {
        expect(shouldAutoComposeInlineAI({ ...makeBlock("帮我看一下disk usage"), exitCode: 127 })).toBe(true);
        expect(shouldAutoComposeInlineAI({ ...makeBlock("帮我看一下磁盘空间"), exitCode: 127 })).toBe(true);
    });

    it("uses the natural-language heuristic only after a command-not-found failure", () => {
        expect(isLikelyNaturalLanguageCommand("help me check disk usage")).toBe(true);
        expect(isLikelyNaturalLanguageCommand("git status --short")).toBe(false);
        const naturalLanguage = { ...makeBlock("help me check disk usage"), exitCode: 127 };
        expect(shouldAutoComposeInlineAI(naturalLanguage)).toBe(true);
        expect(shouldAutoComposeInlineAI({ ...naturalLanguage, exitCode: 1 })).toBe(false);
        expect(shouldAutoComposeInlineAI({ ...naturalLanguage, state: "running", exitCode: null })).toBe(false);
    });
});
