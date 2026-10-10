// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as TermTypes from "@xterm/xterm";
import { describe, expect, it } from "vitest";

import {
    bufferLinesToText,
    canUseTerminalCache,
    computeTheme,
    DefaultTermTheme,
    resolveTermMinimumContrastRatio,
    resolveTermScrollback,
    resolveTermThemeName,
    resolveTermTransparency,
    shouldUseWebGlRenderer,
} from "@/app/view/term/termutil";

const FullConfig = {
    termthemes: {
        [DefaultTermTheme]: {
            background: "#000000",
            foreground: "#c1c1c1",
        },
        dracula: {
            background: "#282a36",
            foreground: "#f8f8f2",
        },
    },
} as unknown as FullConfigType;

function makeBuffer(rows: Array<{ text: string; isWrapped?: boolean }>): TermTypes.IBuffer {
    return {
        length: rows.length,
        getLine: (index: number) => {
            const row = rows[index];
            if (row == null) {
                return undefined;
            }
            return {
                isWrapped: row.isWrapped === true,
                translateToString: (trimRight?: boolean) => (trimRight ? row.text.replace(/\s+$/, "") : row.text),
            };
        },
    } as unknown as TermTypes.IBuffer;
}

describe("bufferLinesToText", () => {
    it("keeps spaces at the end of a wrapped row and trims only true line ends", () => {
        const buffer = makeBuffer([
            { text: "echo hello   " },
            { text: "world  ", isWrapped: true },
            { text: "next line   " },
        ]);

        expect(bufferLinesToText(buffer, 0, 3)).toEqual(["echo hello   world", "next line"]);
    });
});

function waveFile(overrides: Partial<WaveFile>): WaveFile {
    return {
        zoneid: "block-1",
        name: "term",
        opts: {},
        createdts: 0,
        size: 1000,
        modts: 0,
        meta: {},
        ...overrides,
    };
}

describe("canUseTerminalCache", () => {
    const base = {
        cacheFile: waveFile({ name: "cache:term:full", meta: { fileepoch: 3 } }),
        cacheByteLength: 100,
        ptyOffset: 800,
        mainFile: waveFile({ size: 1000 }),
        termFileEpoch: 3,
    };

    it("accepts a cache that lines up with the term file", () => {
        expect(canUseTerminalCache(base)).toBe(true);
    });

    it("rejects missing, empty, mismatched-epoch, or out-of-range caches", () => {
        expect(canUseTerminalCache({ ...base, cacheFile: null })).toBe(false);
        expect(canUseTerminalCache({ ...base, cacheByteLength: 0 })).toBe(false);
        expect(canUseTerminalCache({ ...base, ptyOffset: 0 })).toBe(false);
        expect(canUseTerminalCache({ ...base, ptyOffset: 1001 })).toBe(false);
        expect(canUseTerminalCache({ ...base, termFileEpoch: 4 })).toBe(false);
    });

    it("rejects a cache offset that a circular term file has already overwritten", () => {
        const circular = waveFile({ size: 5000, opts: { maxsize: 1000, circular: true } });
        expect(canUseTerminalCache({ ...base, mainFile: circular, ptyOffset: 4500 })).toBe(true);
        expect(canUseTerminalCache({ ...base, mainFile: circular, ptyOffset: 4000 })).toBe(true);
        expect(canUseTerminalCache({ ...base, mainFile: circular, ptyOffset: 3999 })).toBe(false);
    });
});

describe("resolveTermScrollback", () => {
    it("prefers block meta over settings and clamps the result", () => {
        expect(resolveTermScrollback(null, null)).toBe(2000);
        expect(resolveTermScrollback(5000.7, null)).toBe(5000);
        expect(resolveTermScrollback(5000, 300)).toBe(300);
        expect(resolveTermScrollback(-5, null)).toBe(0);
        expect(resolveTermScrollback(900000, null)).toBe(50000);
    });
});

describe("term theme defaults (dark-only)", () => {
    it("falls back to the default dark theme when none is configured", () => {
        expect(resolveTermThemeName(null)).toBe(DefaultTermTheme);
        expect(resolveTermThemeName("dracula")).toBe("dracula");
    });

    it("uses the default terminal transparency unless overridden", () => {
        expect(resolveTermTransparency(null, DefaultTermTheme)).toBe(0.5);
        expect(resolveTermTransparency(0.2, DefaultTermTheme)).toBe(0.2);
    });

    it("always uses the WebGL renderer unless explicitly disabled", () => {
        const [darkTheme] = computeTheme(FullConfig, DefaultTermTheme, 0.5);
        expect(shouldUseWebGlRenderer(false, darkTheme)).toBe(true);
        expect(shouldUseWebGlRenderer(true, darkTheme)).toBe(false);
    });

    it("uses the default minimum contrast ratio", () => {
        const [darkTheme] = computeTheme(FullConfig, DefaultTermTheme, 0.5);
        expect(resolveTermMinimumContrastRatio(darkTheme)).toBe(1);
    });
});
