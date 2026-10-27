// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { quotePowerShellPath } from "@/util/shellquote";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { makeCompletionAcceptSequence } from "./accept";
import { applyPromptInputData } from "./input-mirror";
import { buildCompletionContext } from "./tokenizer";
import type { CompletionContext, CompletionItem } from "./types";

function makeItem(insertText: string): CompletionItem {
    return { label: insertText, insertText, kind: "subcommand" };
}

function makeContext(overrides: Partial<CompletionContext>): CompletionContext {
    return {
        inputText: "git ch",
        cursorIndex: 6,
        tokens: [
            { text: "git", start: 0, end: 3 },
            { text: "ch", start: 4, end: 6 },
        ],
        searchTerm: "ch",
        tokenIndex: 1,
        tokenType: "subcommand",
        cwd: "/repo",
        connId: "",
        shellType: "zsh",
        env: {},
        recentCommands: [],
        ...overrides,
    };
}

describe("makeCompletionAcceptSequence", () => {
    const nativeShells =
        process.platform === "win32"
            ? ["powershell.exe", "pwsh.exe"].filter(
                  (shell) => spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"]).status === 0
              )
            : [];
    for (const shell of nativeShells) {
        it(`preserves splatting and array punctuation in completed filenames in ${shell}`, () => {
            const paths = ["@literal.txt", "a,b.txt", "plain.txt"];
            const commands = paths.map((path) => {
                const input = { text: "Capture-Completion x", cursorIndex: 20 };
                const ctx = buildCompletionContext(input, {
                    cwd: "C:\\repo",
                    connId: "",
                    shellType: "pwsh",
                    recentCommands: [],
                    env: {},
                });
                return applyPromptInputData(
                    input,
                    makeCompletionAcceptSequence(ctx, {
                        label: path,
                        insertText: path,
                        kind: "file",
                    })
                ).text;
            });
            const script =
                "function Capture-Completion { [Console]::WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject @($args) -Compress)))) }\n" +
                commands.join("\n");
            const output = execFileSync(
                shell,
                ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
                { encoding: "utf8", timeout: 15000 }
            );
            expect(
                output
                    .trim()
                    .split(/\r?\n/)
                    .map((line) => JSON.parse(Buffer.from(line, "base64").toString("utf8")))
            ).toEqual(paths.map((path) => [path]));
        });

        it(`passes accepted paths as one exact native argument in ${shell}`, () => {
            const paths = [
                "C:\\中文 files\\O'Brien $HOME.txt",
                "\\\\server\\share\\a b.txt",
                ".\\中文\\a`&b.txt",
                "C:/Program Files/文档.txt",
            ];
            const nodeScript =
                "process.stdout.write(Buffer.from(JSON.stringify(process.argv.slice(1))).toString('base64')+'\\n')";
            const prefix = `& ${quotePowerShellPath(process.execPath)} -e ${quotePowerShellPath(nodeScript)} `;
            const commands = paths.map((path) => {
                const input = { text: prefix + '"C:\\pa', cursorIndex: prefix.length + 6 };
                const ctx = buildCompletionContext(input, {
                    cwd: "C:\\repo",
                    connId: "",
                    shellType: "pwsh",
                    recentCommands: [],
                    env: {},
                });
                return applyPromptInputData(
                    input,
                    makeCompletionAcceptSequence(ctx, { label: path, insertText: path, kind: "file" })
                ).text;
            });
            const script = commands.join("\n");
            const output = execFileSync(
                shell,
                ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
                { encoding: "utf8", timeout: 15000 }
            );
            expect(
                output
                    .trim()
                    .split(/\r?\n/)
                    .map((line) => JSON.parse(Buffer.from(line, "base64").toString("utf8")))
            ).toEqual(paths.map((path) => [path]));
        });
    }

    it.each([
        [
            'Get-Item "C:/Program Fi',
            "C:/Program Files/O'Brien $HOME.txt",
            "Get-Item 'C:/Program Files/O''Brien $HOME.txt'",
        ],
        ["Get-Item 'C:\\文档\\O''Br", "C:\\文档\\O'Brien $HOME.txt", "Get-Item 'C:\\文档\\O''Brien $HOME.txt'"],
        ["cd .\\su", ".\\sub folder\\", "cd '.\\sub folder\\'"],
        [
            "Get-Item \\\\server\\share\\O",
            "\\\\server\\share\\O'Brien.txt",
            "Get-Item '\\\\server\\share\\O''Brien.txt'",
        ],
    ])("accepts PowerShell file completion in %s without losing literal quoting", (line, path, expected) => {
        const input = { text: line, cursorIndex: line.length };
        const ctx = buildCompletionContext(input, {
            cwd: "C:\\repo",
            connId: "",
            shellType: "pwsh",
            recentCommands: [],
            env: {},
        });
        const sequence = makeCompletionAcceptSequence(ctx, { label: path, insertText: path, kind: "file" });
        expect(applyPromptInputData(input, sequence).text).toBe(expected);
    });

    it("uses PowerShell's call operator for a quoted executable path exactly once", () => {
        for (const line of ['"C:\\Program Fi', '& "C:\\Program Fi']) {
            const input = { text: line, cursorIndex: line.length };
            const ctx = buildCompletionContext(input, {
                cwd: "C:\\repo",
                connId: "",
                shellType: "pwsh",
                recentCommands: [],
                env: {},
            });
            const sequence = makeCompletionAcceptSequence(ctx, {
                label: "tool.exe",
                insertText: "C:\\Program Files\\tool.exe",
                kind: "file",
            });
            expect(applyPromptInputData(input, sequence).text).toBe("& 'C:\\Program Files\\tool.exe'");
        }
    });

    it("quotes a POSIX path while preserving home expansion", () => {
        const input = { text: 'cat "~/my fi', cursorIndex: 11 };
        const ctx = buildCompletionContext(input, {
            cwd: "/repo",
            connId: "devbox",
            shellType: "bash",
            recentCommands: [],
            env: {},
        });
        const sequence = makeCompletionAcceptSequence(ctx, { label: "my file", insertText: "~/my file", kind: "file" });
        expect(applyPromptInputData(input, sequence).text).toBe("cat ~/'my file'");
    });
    it("replaces the current token prefix with the completion text", () => {
        expect(makeCompletionAcceptSequence(makeContext({}), makeItem("checkout"))).toBe("\x7f\x7fcheckout");
    });

    it("deletes token suffix before replacing a mid-token completion", () => {
        expect(
            makeCompletionAcceptSequence(
                makeContext({
                    inputText: "git chekout",
                    cursorIndex: 6,
                    tokens: [
                        { text: "git", start: 0, end: 3 },
                        { text: "chekout", start: 4, end: 11 },
                    ],
                    searchTerm: "ch",
                }),
                makeItem("checkout")
            )
        ).toBe("\x1b[C".repeat(5) + "\x7f".repeat(7) + "checkout");
    });

    it("never relies on forward-delete, which a stock zsh inserts as a literal tilde", () => {
        const ctx = makeContext({
            inputText: "git chekout main",
            cursorIndex: 6,
            tokens: [
                { text: "git", start: 0, end: 3 },
                { text: "chekout", start: 4, end: 11 },
            ],
            searchTerm: "ch",
        });
        const sequence = makeCompletionAcceptSequence(ctx, makeItem("checkout"));

        expect(sequence).not.toContain("\x1b[3~");
        expect(applyPromptInputData({ text: ctx.inputText, cursorIndex: ctx.cursorIndex }, sequence)).toEqual({
            text: "git checkout main",
            cursorIndex: 12,
        });
    });

    it("inserts into an empty fresh token without deleting anything", () => {
        expect(
            makeCompletionAcceptSequence(
                makeContext({
                    inputText: "git ",
                    cursorIndex: 4,
                    tokens: [{ text: "git", start: 0, end: 3 }],
                    searchTerm: "",
                    tokenIndex: 1,
                }),
                makeItem("status")
            )
        ).toBe("status");
    });

    it("counts multibyte characters as one shell cursor step", () => {
        expect(
            makeCompletionAcceptSequence(
                makeContext({
                    inputText: "cat 文",
                    cursorIndex: 5,
                    tokens: [
                        { text: "cat", start: 0, end: 3 },
                        { text: "文", start: 4, end: 5 },
                    ],
                    searchTerm: "文",
                }),
                makeItem("文件.txt")
            )
        ).toBe("\x7f文件.txt");
    });

    it("can replace the full input line for AI command proposals", () => {
        expect(
            makeCompletionAcceptSequence(
                makeContext({
                    inputText: "show disk usage",
                    cursorIndex: 15,
                    tokens: [
                        { text: "show", start: 0, end: 4 },
                        { text: "disk", start: 5, end: 9 },
                        { text: "usage", start: 10, end: 15 },
                    ],
                    searchTerm: "usage",
                    tokenIndex: 2,
                    tokenType: "argument",
                }),
                { label: "df -h", insertText: "df -h", kind: "ai", replaceStart: 0, replaceEnd: 15 }
            )
        ).toBe("\x7f".repeat(15) + "df -h");
    });
});
