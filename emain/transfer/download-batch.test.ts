// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";
import { describe, expect, it } from "vitest";
import { planBatchDownloads } from "./download-batch";

describe("batch download destinations", () => {
    it("keeps both without overwriting existing or duplicate names, preserving extensions", () => {
        const items = ["/a/log.txt", "/b/log.txt"].map((value) => ({ path: `genie://host/${value}`, isdir: false }));
        expect(
            planBatchDownloads(
                items,
                "/downloads",
                "keep",
                (candidate) => candidate === "/downloads/log.txt",
                path.posix
            ).map((plan) => plan.destination)
        ).toEqual(["/downloads/log (1).txt", "/downloads/log (2).txt"]);
    });
    it("skips existing conflicts with one batch policy", () => {
        const items = ["old", "new"].map((name) => ({ path: `genie://host//${name}`, isdir: true }));
        expect(
            planBatchDownloads(items, "/downloads", "skip", (candidate) => candidate.endsWith("/old"), path.posix).map(
                (plan) => plan.label
            )
        ).toEqual(["new"]);
    });
    it("reserves case and Unicode aliases within a macOS batch before files exist", () => {
        const items = ["Log.txt", "log.txt", "caf\u00e9.txt", "cafe\u0301.txt"].map((name) => ({
            path: `genie://host//${name}`,
            isdir: false,
        }));
        expect(
            planBatchDownloads(items, "/downloads", "keep", () => false, path.posix, "darwin").map(
                (plan) => plan.destination
            )
        ).toEqual([
            "/downloads/Log.txt",
            "/downloads/log (1).txt",
            "/downloads/caf\u00e9.txt",
            "/downloads/cafe\u0301 (1).txt",
        ]);
        expect(planBatchDownloads(items, "/downloads", "skip", () => false, path.posix, "darwin")).toHaveLength(2);
        expect(
            planBatchDownloads(items, "/downloads", "keep", () => false, path.posix, "linux").map((plan) => plan.label)
        ).toEqual(items.map((item) => item.path.split("/").pop()));
    });
    it.each(["NUL", "con.txt", "COM1.log", "lpt\u00b9.txt", "log.", "log "])(
        "rejects the Windows device or aliased filename %s",
        (name) => {
            expect(() =>
                planBatchDownloads(
                    [{ path: `genie://host//${name}`, isdir: false }],
                    "C:\\Downloads",
                    "keep",
                    () => false,
                    path.win32
                )
            ).toThrow("local file name");
        }
    );
    it("rejects unsafe local names and unsupported folders", () => {
        expect(() =>
            planBatchDownloads(
                [{ path: "genie://host//tmp/bad\\name", isdir: false }],
                "C:\\Downloads",
                "keep",
                () => false,
                path.win32
            )
        ).toThrow("local file name");
        expect(() =>
            planBatchDownloads(
                [{ path: "genie://wsl://Ubuntu//tmp/logs", isdir: true }],
                "C:\\Downloads",
                "keep",
                () => false,
                path.win32
            )
        ).toThrow("WSL");
    });
});
