// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { makeTreeNodeKey } from "./preview-directory-tree";

describe("preview directory tree", () => {
    it("keys home-shortened paths by connection", () => {
        expect(makeTreeNodeKey("local", "~/projects")).toBe("local:~/projects");
        expect(makeTreeNodeKey("zrgong@paw-5090-ws", "~/projects")).toBe("zrgong@paw-5090-ws:~/projects");
    });
});
