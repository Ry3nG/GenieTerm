// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { makePathCommandCompletionProvider, parsePathExecutables } from "./path-provider";
import type { CompletionContext } from "./types";

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "nvidia",
        cursorIndex: 6,
        tokens: [{ text: "nvidia", start: 0, end: 6 }],
        searchTerm: "nvidia",
        tokenIndex: 0,
        tokenType: "command",
        cwd: "/home/u",
        connId: "path-spec",
        shellType: "zsh",
        env: {},
        recentCommands: [],
        ...overrides,
    };
}

describe("parsePathExecutables", () => {
    it("trims and dedupes executable names", () => {
        expect(parsePathExecutables("git\nnvidia-smi\ngit\n\n  ls  \n")).toEqual(["git", "nvidia-smi", "ls"]);
    });
});

describe("makePathCommandCompletionProvider", () => {
    it("bounds cached PowerShell prefixes", async () => {
        const runGenerator = vi.fn(async () => ({ stdout: "", supported: true }));
        const provider = makePathCommandCompletionProvider(runGenerator);
        for (let i = 0; i <= 128; i++) {
            await provider.provideCompletions(
                makeContext({
                    connId: "prefix-cache-bound",
                    shellType: "pwsh",
                    shellName: "powershell",
                    searchTerm: `Get-Prefix${i}`,
                })
            );
        }
        await provider.provideCompletions(
            makeContext({
                connId: "prefix-cache-bound",
                shellType: "pwsh",
                shellName: "powershell",
                searchTerm: "Get-Prefix0",
            })
        );
        expect(runGenerator).toHaveBeenCalledTimes(130);
    });

    it("uses the actual PowerShell edition and keeps caches separate from POSIX shells", async () => {
        const runGenerator = vi.fn(async () => ({ stdout: "Get-ChildItem\nGet-Clipboard\n", supported: true }));
        const provider = makePathCommandCompletionProvider(runGenerator);
        for (const shellName of ["powershell", "pwsh"] as const) {
            const items = await provider.provideCompletions(
                makeContext({
                    connId: "same-host",
                    shellType: "pwsh",
                    shellName,
                    cwd: "C:\\repo",
                    searchTerm: "Get-Ch",
                })
            );
            expect(runGenerator).toHaveBeenLastCalledWith({
                command: shellName,
                args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", expect.stringContaining("Get-Command")],
                cwd: "C:\\repo",
                connId: "same-host",
                env: { GENIETERM_COMPLETION_PREFIX: "Get-Ch" },
            });
            expect(items.map((item) => item.label)).toEqual(["Get-ChildItem"]);
        }
        await provider.provideCompletions(makeContext({ connId: "same-host", shellType: "bash" }));
        expect(runGenerator).toHaveBeenLastCalledWith(expect.objectContaining({ command: "sh" }));
        expect(runGenerator).toHaveBeenCalledTimes(3);
    });

    const powerShells =
        process.platform === "win32"
            ? ["powershell", "pwsh"].filter(
                  (shell) => spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"]).status === 0
              )
            : [];
    for (const shellName of powerShells) {
        it(`discovers real cmdlets through ${shellName}`, async () => {
            const provider = makePathCommandCompletionProvider(async ({ command, args, env }) => ({
                stdout: execFileSync(command, args, {
                    env: { ...process.env, ...env },
                    encoding: "utf8",
                    timeout: 15000,
                }),
                supported: true,
            }));
            const items = await provider.provideCompletions(
                makeContext({
                    connId: "native-" + shellName,
                    shellType: "pwsh",
                    shellName: shellName as "pwsh" | "powershell",
                    cwd: process.cwd(),
                    searchTerm: "Get-Ch",
                })
            );
            expect(items.some((item) => item.label === "Get-ChildItem")).toBe(true);
        });
    }

    it("lists PATH executables matching the command prefix (e.g. nvidia-*)", async () => {
        const runGenerator = vi.fn(async () => ({
            stdout: "nvidia-smi\nnvidia-detector\nnvidia-bug-report.sh\nls\ngit\n",
            supported: true,
        }));
        const provider = makePathCommandCompletionProvider(runGenerator);

        const items = await provider.provideCompletions(makeContext({ connId: "path-nvidia" }));

        expect(runGenerator).toHaveBeenCalledWith({
            command: "sh",
            args: ["-c", expect.stringContaining("$PATH")],
            cwd: "/home/u",
            connId: "path-nvidia",
        });
        expect(items.map((item) => item.label)).toEqual(["nvidia-smi", "nvidia-detector", "nvidia-bug-report.sh"]);
        expect(items[0]).toMatchObject({ kind: "command", source: "path" });
    });

    it("does not run except at the command position", async () => {
        const runGenerator = vi.fn(async () => ({ stdout: "", supported: true }));
        const provider = makePathCommandCompletionProvider(runGenerator);

        const items = await provider.provideCompletions(
            makeContext({ tokenIndex: 1, searchTerm: "foo", connId: "path-noop" })
        );

        expect(runGenerator).not.toHaveBeenCalled();
        expect(items).toEqual([]);
    });
});
