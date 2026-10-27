// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { quotePowerShellPath } from "./shellquote";

describe("quotePowerShellPath", () => {
    it("keeps PowerShell metacharacters literal and only expands a leading home token", () => {
        expect(quotePowerShellPath("O'Brien $HOME `&.txt")).toBe("'O''Brien $HOME `&.txt'");
        expect(quotePowerShellPath("~/O'Brien $HOME")).toBe("($HOME + '/O''Brien $HOME')");
        expect(quotePowerShellPath("~\\文档")).toBe("($HOME + '\\文档')");
        expect(quotePowerShellPath("~")).toBe("$HOME");
    });

    const shells =
        process.platform === "win32"
            ? ["powershell.exe", "pwsh.exe"].filter(
                  (shell) => spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"]).status === 0
              )
            : [];
    for (const shell of shells) {
        it(`preserves exact native argv through ${shell}`, () => {
            const paths = [
                "C:\\中文 files\\O'Brien $HOME.txt",
                "\\\\server\\share\\O'Brien $HOME.txt",
                ".\\中文 files\\a`&b.txt",
                "C:/Program Files/文档.txt",
            ];
            for (const path of paths) {
                const nodeScript = "process.stdout.write(Buffer.from(process.argv[1]).toString('base64'))";
                const script = `& ${quotePowerShellPath(process.execPath)} -e ${quotePowerShellPath(nodeScript)} ${quotePowerShellPath(path)}`;
                const output = execFileSync(
                    shell,
                    [
                        "-NoProfile",
                        "-NonInteractive",
                        "-EncodedCommand",
                        Buffer.from(script, "utf16le").toString("base64"),
                    ],
                    { encoding: "utf8", timeout: 15000 }
                );
                expect(Buffer.from(output.trim(), "base64").toString("utf8")).toBe(path);
            }
        });
    }
});
