// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("@/view/term/term-model", () => ({ TermViewModel: vi.fn() }));
vi.mock("@/app/view/preview/preview-model", () => ({ PreviewModel: vi.fn() }));

import { loadViewModel, makeViewModel } from "./blockregistry";

describe("deferred view models", () => {
    it("keeps terminals synchronous and ignores unknown view names", () => {
        expect(loadViewModel("term")).toBeNull();
        expect(loadViewModel("unknown")).toBeNull();
        expect(loadViewModel("constructor")).toBeNull();
    });

    it("shares an import and constructs independent models only after loading", async () => {
        const pending = loadViewModel("preview");
        expect(pending).toBe(loadViewModel("preview"));
        await pending;
        expect(loadViewModel("preview")).toBeNull();
        const { PreviewModel } = await import("@/app/view/preview/preview-model");
        expect(PreviewModel).not.toHaveBeenCalled();
        const first = makeViewModel("first", "preview", null, null, null);
        const second = makeViewModel("second", "preview", null, null, null);
        expect(first).not.toBe(second);
        expect(PreviewModel).toHaveBeenCalledTimes(2);
    });
});
