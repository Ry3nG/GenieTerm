// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { computeBgStyleFromMeta, processBackgroundUrls } from "./waveutil";

describe("background CSS", () => {
    it("preserves gradients and quoted remote URLs with the focused CSS parser", () => {
        expect(processBackgroundUrls("background: linear-gradient(red, blue);")).toBe("linear-gradient(red,blue)");
        expect(processBackgroundUrls('url("https://example.com/a b.png") center / cover')).toContain(
            "https://example.com/a\\ b.png"
        );
    });

    it("rejects unsafe URLs even when nested in CSS functions", () => {
        expect(processBackgroundUrls('image-set(url("javascript:alert(1)") 1x)')).toBeNull();
        expect(processBackgroundUrls('url("file://relative/path")')).toBeNull();
    });

    it("keeps empty backgrounds and opacity behavior", () => {
        expect(computeBgStyleFromMeta(null)).toBeNull();
        expect(computeBgStyleFromMeta({ bg: "red", "bg:opacity": 2 })).toEqual({ background: "red", opacity: 1 });
    });
});
