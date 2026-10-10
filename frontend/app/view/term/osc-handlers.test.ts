import { stringToBase64 } from "@/util/util";
import { describe, expect, it, vi } from "vitest";

import { isCmdBlockCommandPlaceholder } from "./cmdblocks";
import { decodeOsc16162CommandText, isClaudeCodeCommand } from "./osc-handlers";

describe("isClaudeCodeCommand", () => {
    it("matches direct Claude Code invocations", () => {
        expect(isClaudeCodeCommand("claude")).toBe(true);
        expect(isClaudeCodeCommand("claude --dangerously-skip-permissions")).toBe(true);
    });

    it("matches Claude Code invocations wrapped with env assignments", () => {
        expect(isClaudeCodeCommand('ANTHROPIC_API_KEY="test" claude')).toBe(true);
        expect(isClaudeCodeCommand("env FOO=bar claude --print")).toBe(true);
    });

    it("ignores other commands", () => {
        expect(isClaudeCodeCommand("claudes")).toBe(false);
        expect(isClaudeCodeCommand("echo claude")).toBe(false);
        expect(isClaudeCodeCommand("ls ~/claude")).toBe(false);
        expect(isClaudeCodeCommand("cat /logs/claude")).toBe(false);
        expect(isClaudeCodeCommand("")).toBe(false);
    });
});

describe("decodeOsc16162CommandText", () => {
    it("decodes valid payloads and replaces oversized ones with a placeholder", () => {
        expect(decodeOsc16162CommandText(stringToBase64("npm test"))).toBe("npm test");
        expect(decodeOsc16162CommandText(null)).toBeNull();
        expect(isCmdBlockCommandPlaceholder(decodeOsc16162CommandText("A".repeat(12000)))).toBe(true);
    });

    it("returns null for malformed base64 instead of throwing", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect(decodeOsc16162CommandText("bm90 IGJhc2U2NA==!!")).toBeNull();
        } finally {
            consoleError.mockRestore();
        }
    });
});
