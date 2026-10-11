// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatReleaseNotes, summarizeReleaseNotes } from "./update-release-notes";

describe("formatReleaseNotes", () => {
    it("formats GitHub generated HTML as dialog-safe text", () => {
        expect(
            formatReleaseNotes(
                '<p><strong>Full Changelog</strong>: <a class="commit-link" href="https://github.com/Ry3nG/GenieTerm/compare/v0.4.69...v0.4.70"><tt>v0.4.69...v0.4.70</tt></a></p>'
            )
        ).toBe("Full Changelog: v0.4.69...v0.4.70");
    });

    it("formats markdown without leaking syntax into system dialogs", () => {
        expect(
            formatReleaseNotes(
                "**Full Changelog**: [v0.4.69...v0.4.70](https://github.com/Ry3nG/GenieTerm/compare/v0.4.69...v0.4.70)"
            )
        ).toBe("Full Changelog: v0.4.69...v0.4.70");
    });

    it("formats release note arrays", () => {
        expect(
            formatReleaseNotes([
                {
                    version: "0.4.70",
                    note: "<ul><li>Fixed update prompts</li><li>Improved installer metadata</li></ul>",
                },
            ])
        ).toBe("0.4.70: Fixed update prompts\nImproved installer metadata");
    });
});

describe("summarizeReleaseNotes", () => {
    it("takes the paragraph under the title and skips sections and lists", () => {
        const notes = [
            "<!-- Copyright 2026, GenieTerm. Apache-2.0. -->",
            "",
            "# GenieTerm 1.0.1",
            "",
            "The Host view now fits whatever space you give it, and **slow links** stay calm.",
            "",
            "## One status line",
            "",
            "- Every block shows at most one message.",
        ].join("\n");
        expect(summarizeReleaseNotes(notes)).toBe(
            "The Host view now fits whatever space you give it, and slow links stay calm."
        );
    });

    it("shortens a long opening at a sentence and handles missing notes", () => {
        const long = `# Title\n\n${"This release makes things better. ".repeat(12)}`;
        const summary = summarizeReleaseNotes(long);
        expect(summary.length).toBeLessThanOrEqual(221);
        expect(summary.endsWith(".")).toBe(true);
        expect(summarizeReleaseNotes(null)).toBeNull();
        expect(summarizeReleaseNotes("# Only a title")).toBeNull();
        expect(summarizeReleaseNotes([{ version: "1.0.1", note: "# T\n\nFirst." }])).toBe("First.");
    });
});
