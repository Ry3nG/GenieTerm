// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    CommandHistoryLimit,
    applyCommandLibraryChange,
    emptyCommandLibrary,
    filterCommandHistory,
    normalizeCommandRecipe,
    normalizeHistoryEntry,
    recipeParameterNames,
    recoverCommandLibrary,
    resolveCommandRecipe,
    type CommandHistoryEntry,
    type CommandRecipe,
} from "./commandlibrary";

function entry(id = "a", overrides: Partial<CommandHistoryEntry> = {}): CommandHistoryEntry {
    return {
        id,
        blockid: "block",
        tabid: "tab",
        commandblockid: 1,
        command: "git status",
        connection: "",
        cwd: "/project",
        shell: "bash",
        startts: 1000,
        donets: null,
        exitcode: null,
        status: "running",
        ...overrides,
    };
}

function recipe(overrides: Partial<CommandRecipe> = {}): CommandRecipe {
    return {
        id: "recipe",
        name: "Find logs",
        template: "find {{folder}} -name {{pattern}}",
        connection: "host",
        cwd: "/work",
        shell: "bash",
        arguments: [
            { name: "folder", kind: "text", value: ".", choices: [] },
            { name: "pattern", kind: "choice", value: "*.log", choices: ["*.log", "*.txt"] },
        ],
        updatedts: 1000,
        ...overrides,
    };
}

describe("bounded command history", () => {
    it("merges different renderer updates, updates completion, and retains only the newest bounded metadata", () => {
        let library = emptyCommandLibrary();
        for (let i = 0; i < CommandHistoryLimit + 10; i++) {
            library = applyCommandLibraryChange(library, {
                type: "record",
                entry: entry(String(i), { startts: i + 1 }),
            });
        }
        library = applyCommandLibraryChange(library, {
            type: "record",
            update: true,
            entry: entry("509", { startts: 510, status: "success", exitcode: 0, donets: 600 }),
        });
        expect(library.history).toHaveLength(CommandHistoryLimit);
        expect(library.history[0]).toMatchObject({ id: "509", status: "success" });
        expect(library.history.some((item) => item.id === "0")).toBe(false);
    });

    it("does not resurrect deleted or cleared running commands when they finish", () => {
        const original = applyCommandLibraryChange(emptyCommandLibrary(), { type: "record", entry: entry() });
        for (const change of [{ type: "deletehistory", id: "a" } as const, { type: "clearhistory" } as const]) {
            const removed = applyCommandLibraryChange(original, change);
            expect(
                applyCommandLibraryChange(removed, {
                    type: "record",
                    entry: entry("a", { status: "success" }),
                    update: true,
                })
            ).toBe(removed);
        }
    });

    it("keeps the original host and folder when terminal metadata changes before completion", () => {
        const original = applyCommandLibraryChange(emptyCommandLibrary(), {
            type: "record",
            entry: entry("a", { connection: "old-host", cwd: "/old" }),
        });
        const updated = applyCommandLibraryChange(original, {
            type: "record",
            update: true,
            entry: entry("a", { connection: "new-host", cwd: "/new", status: "success" }),
        });
        expect(updated.history[0]).toMatchObject({ connection: "old-host", cwd: "/old", status: "success" });
    });

    it("validates persisted data, strips extra fields, and marks stale running results unknown", () => {
        const raw = {
            version: 1,
            history: [
                { ...entry(), output: "do not save" },
                { ...entry("bad"), startts: 1e100 },
            ],
            recipes: [],
        };
        expect(recoverCommandLibrary(raw).history).toEqual([{ ...entry(), status: "unknown" }]);
        expect(normalizeHistoryEntry({ ...entry(), command: "a".repeat(4097) })).toBeNull();
        expect(normalizeHistoryEntry({ ...entry(), command: "echo \x1b[31m" })).toBeNull();
    });

    it("combines host, folder, status and case-insensitive word filters", () => {
        const history = [
            entry("a", { command: "pytest unit", connection: "build", status: "failed" }),
            entry("b", { command: "pytest unit", connection: "local", status: "success" }),
        ];
        expect(
            filterCommandHistory(history, {
                query: "PYTEST build",
                connection: "build",
                cwd: "proj",
                status: "failed",
            }).map((item) => item.id)
        ).toEqual(["a"]);
        expect(filterCommandHistory(history, { query: "absent" })).toEqual([]);
    });
});

describe("literal command recipes", () => {
    it("quotes parameter data, including command substitutions, quotes and metacharacters", () => {
        const result = resolveCommandRecipe(
            recipe(),
            { folder: "it's $(touch /tmp/bad); $HOME", pattern: "*.txt" },
            "bash"
        );
        expect(result.error).toBeUndefined();
        expect(result.command).toBe("find 'it'\\''s $(touch /tmp/bad); $HOME' -name '*.txt'");
    });

    it("quotes PowerShell literally without expanding a home path or expressions", () => {
        const command = recipe({
            template: "Write-Output {{value}}",
            shell: "pwsh",
            arguments: [{ name: "value", kind: "text", value: "~/$HOME O'Brien `&", choices: [] }],
        });
        expect(resolveCommandRecipe(command, {}, "pwsh").command).toBe("Write-Output '~/$HOME O''Brien `&'");
    });

    it("escapes fish backslashes and quotes while preserving values", () => {
        const command = recipe({
            template: "printf %s {{value}}",
            shell: "fish",
            arguments: [{ name: "value", kind: "text", value: "C:\\it's", choices: [] }],
        });
        expect(resolveCommandRecipe(command, {}, "fish").command).toBe("printf %s 'C:\\\\it\\'s'");
    });

    it("rejects placeholders inside quotes or partial words and unknown or mismatched shells", () => {
        for (const template of ['echo "{{folder}}"', "echo prefix{{folder}}", "echo {{folder}}suffix"]) {
            expect(recipeParameterNames(template).error).toBeTruthy();
        }
        expect(resolveCommandRecipe(recipe(), {}, "pwsh").error).toContain("bash");
        expect(resolveCommandRecipe(recipe({ shell: "unknown" }), {}, "unknown").error).toContain("known");
    });

    it("rejects parameter contexts where shell argument quoting does not protect literal data", () => {
        const arguments_ = [{ name: "value", kind: "text" as const, value: "$(printf expanded)", choices: [] }];
        for (const [shell, template] of [
            ["bash", "cat <<EOF\n{{value}}\nEOF"],
            ["bash", "cat <<< {{value}}"],
            ["bash", "echo ok # {{value}}"],
            ["bash", "echo $[ {{value}} ]"],
            ["bash", "echo $(( {{value}} ))"],
            ["bash", "echo $( printf %s {{value}} )"],
            ["bash", 'echo {{value}} "unfinished'],
            ["pwsh", 'Write-Output @"\n{{value}}\n"@'],
            ["pwsh", "Write-Output @'\n{{value}}\n'@"],
            ["pwsh", "Write-Output ok <# {{value}} #>"],
        ]) {
            const command = recipe({ shell, template, arguments: arguments_ });
            expect(normalizeCommandRecipe(command), template).toBeNull();
            expect(resolveCommandRecipe(command, {}, shell).error, template).toBeTruthy();
        }
    });

    it("keeps ordinary quoted arguments and scripts without recipe parameters available", () => {
        const command = recipe({
            template: "printf '%s | < # > [ ]\\n' {{folder}}",
            arguments: [recipe().arguments[0]],
        });
        expect(normalizeCommandRecipe(command)).not.toBeNull();
        expect(resolveCommandRecipe(command, {}, "bash").error).toBeUndefined();
        for (const template of ["cat <<EOF\n$HOME\nEOF", "echo first | cat\necho second # note"]) {
            const script = recipe({ template, arguments: [] });
            expect(normalizeCommandRecipe(script)).not.toBeNull();
            expect(resolveCommandRecipe(script, {}, "bash")).toEqual({ command: template });
        }
    });

    it("does not substitute escaped literal placeholders or unlisted choices", () => {
        const command = recipe({ template: "echo \\{{literal}} {{folder}}", arguments: [recipe().arguments[0]] });
        expect(resolveCommandRecipe(command, {}, "bash").command).toBe("echo \\{{literal}} .");
        expect(resolveCommandRecipe(recipe(), { pattern: "*.secret" }, "bash").error).toBeTruthy();
        expect(normalizeCommandRecipe(recipe({ arguments: [] }))).toBeNull();
        const docker = recipe({ template: "docker inspect --format '{{.State.Running}}' app", arguments: [] });
        expect(resolveCommandRecipe(docker, {}, "bash")).toEqual({ command: docker.template });
    });

    it("saves recipes independently of history and never retains arbitrary persisted fields", () => {
        let library = applyCommandLibraryChange(emptyCommandLibrary(), {
            type: "saverecipe",
            recipe: { ...recipe(), output: "secret" } as CommandRecipe,
        });
        library = applyCommandLibraryChange(library, { type: "clearhistory" });
        expect(library.recipes).toEqual([recipe()]);
    });
});
