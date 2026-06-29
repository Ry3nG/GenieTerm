// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isSafeExternalUrl } from "./safe-open-util";

describe("safe-open", () => {
    it("allows normal browser and mail URLs", () => {
        expect(isSafeExternalUrl("https://example.com/path")).toBe(true);
        expect(isSafeExternalUrl("http://localhost:3000")).toBe(true);
        expect(isSafeExternalUrl("mailto:support@example.com")).toBe(true);
    });

    it("blocks local files, custom protocols, and invalid URLs", () => {
        expect(isSafeExternalUrl("file:///Users/me/secret.txt")).toBe(false);
        expect(isSafeExternalUrl("genie://devbox/tmp/log.txt")).toBe(false);
        expect(isSafeExternalUrl("wsh://devbox/tmp/log.txt")).toBe(false);
        expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeExternalUrl("not a url")).toBe(false);
        expect(isSafeExternalUrl("")).toBe(false);
    });
});
