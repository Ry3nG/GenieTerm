// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { TermCompletionService } from "./completion-service";
import type { RunCompletionGenerator } from "./fig-static-provider";
import { makeHelpFallbackCompletionProvider } from "./help-provider";
import { getPowerShellCommandMetadata, makePowerShellParameterCompletionProvider } from "./powershell-provider";
import { buildCompletionContext } from "./tokenizer";
import type { CompletionContext, ShellName } from "./types";

function context(
    line = "Get-ChildItem -Pa",
    connId = "ps-parameters",
    shellName: ShellName = "powershell"
): CompletionContext {
    return buildCompletionContext(
        { text: line, cursorIndex: line.length },
        {
            cwd: "C:\\repo",
            connId,
            shellName,
            shellType: "pwsh",
            recentCommands: [],
            env: {},
        }
    );
}

const Metadata = {
    native: false,
    parameters: [
        { name: "Path", aliases: [] },
        { name: "LiteralPath", aliases: ["PSPath", "LP"] },
        { name: "Force", aliases: [] },
        { name: "Verbose", aliases: ["vb"] },
    ],
};

describe("PowerShell parameter completion", () => {
    it("queries metadata instead of invoking cmdlets with --help", async () => {
        const run = vi.fn<RunCompletionGenerator>(async () => ({ supported: true, stdout: JSON.stringify(Metadata) }));
        const service = new TermCompletionService([
            makePowerShellParameterCompletionProvider(run),
            makeHelpFallbackCompletionProvider(run, () => false),
        ]);
        expect((await service.provideCompletions(context())).map((item) => item.insertText)).toEqual(["-Path"]);
        expect(run).toHaveBeenCalledOnce();
        expect(run.mock.calls[0][0]).toMatchObject({
            command: "powershell",
            env: { GENIETERM_COMPLETION_COMMAND: "Get-ChildItem" },
        });
        expect(run.mock.calls[0][0].args).not.toContain("--help");
    });

    it("matches common parameters and aliases and excludes already-used parameters", async () => {
        const run = vi.fn(async () => ({ supported: true, stdout: JSON.stringify(Metadata) }));
        const provider = makePowerShellParameterCompletionProvider(run);
        expect((await provider.provideCompletions(context("gci -Ver", "ps-alias"))).map((item) => item.label)).toEqual([
            "-Verbose",
        ]);
        const service = new TermCompletionService([provider]);
        expect((await service.provideCompletions(context("gci -PSP", "ps-alias"))).map((item) => item.label)).toEqual([
            "-LiteralPath",
        ]);
        expect(await service.provideCompletions(context("gci -LP x -Lit", "ps-alias"))).toEqual([]);
    });

    it("passes command names only as environment data, handles no match, and leaves POSIX untouched", async () => {
        const run = vi.fn<RunCompletionGenerator>(async () => ({ supported: true, stdout: "" }));
        const provider = makePowerShellParameterCompletionProvider(run);
        const ctx = context("Missing-Command -Pa", "ps-missing");
        expect(await provider.provideCompletions(ctx)).toEqual([]);
        ctx.tokens[0].text = "Get-Item; Write-Output INJECTED";
        expect(await provider.provideCompletions(ctx)).toEqual([]);
        const request = run.mock.calls.at(-1)[0];
        expect(request.env.GENIETERM_COMPLETION_COMMAND).toBe("Get-Item; Write-Output INJECTED");
        expect(request.args.join(" ")).not.toContain("INJECTED");
        run.mockClear();
        expect(
            await provider.provideCompletions({ ...ctx, shellType: "bash", connId: "linux-host", cwd: "/home/me" })
        ).toEqual([]);
        expect(run).not.toHaveBeenCalled();
    });

    it("retains --help discovery for real native applications in PowerShell", async () => {
        const run = vi.fn(async (request) => ({
            supported: true,
            stdout:
                request.command === "native-tool"
                    ? "  --special  Native flag"
                    : JSON.stringify({ native: true, parameters: [] }),
        }));
        const provider = makeHelpFallbackCompletionProvider(run, () => false);
        expect(
            (await provider.provideCompletions(context("native-tool --spe", "ps-native-app"))).map((item) => item.label)
        ).toEqual(["--special"]);
        expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ command: "native-tool", args: ["--help"] }));
    });

    it("bounds metadata cache entries", async () => {
        const run = vi.fn(async () => ({ supported: true, stdout: JSON.stringify(Metadata) }));
        for (let i = 0; i <= 128; i++) {
            await getPowerShellCommandMetadata(run, context(`Get-Cached${i} -Pa`, "ps-cache-bound"));
        }
        await getPowerShellCommandMetadata(run, context("Get-Cached0 -Pa", "ps-cache-bound"));
        expect(run).toHaveBeenCalledTimes(130);
    });

    const shells =
        process.platform === "win32"
            ? ["powershell", "pwsh"].filter(
                  (shell) => spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"]).status === 0
              )
            : [];
    for (const shell of shells) {
        it(`reads real cmdlet and alias parameters in ${shell}`, async () => {
            const provider = makePowerShellParameterCompletionProvider(async ({ command, args, env }) => ({
                supported: true,
                stdout: execFileSync(command, args, {
                    env: { ...process.env, ...env },
                    encoding: "utf8",
                    timeout: 15000,
                }),
            }));
            for (const [line, expected] of [
                ["Get-ChildItem -Pa", "-Path"],
                ["gci -PSP", "-LiteralPath"],
                ["gci -Ver", "-Verbose"],
            ]) {
                const items = await provider.provideCompletions(
                    context(line, "native-parameters-" + shell, shell as ShellName)
                );
                expect(
                    items.map((item) => item.label),
                    line
                ).toContain(expected);
            }
        });
    }
});
