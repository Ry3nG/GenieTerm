// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatReleaseNotes } from "./update-release-notes";

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
