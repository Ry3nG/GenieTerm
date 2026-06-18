// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { blockViewToIcon, blockViewToName } from "./blockutil";

describe("block view labels", () => {
    it("does not present retired help and tips views as built-ins", () => {
        expect(blockViewToIcon("help")).toBe("square");
        expect(blockViewToName("help")).toBe("help");

        expect(blockViewToIcon("tips")).toBe("square");
        expect(blockViewToName("tips")).toBe("tips");
    });
});
