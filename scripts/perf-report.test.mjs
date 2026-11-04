// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { decodeAppend, findEcho, percentile, summarizeReports } from "./perf-report.mjs";

describe("performance measurements", () => {
  it("does not count another terminal's output or stale output as input echo", () => {
    const events = [
      { blockId: "busy", ts: 12, data: "x" },
      { blockId: "active", ts: 8, data: "x" },
      { blockId: "active", ts: 14, data: "prompt" },
      { blockId: "active", ts: 17, data: "x" },
    ];
    expect(findEcho(events, "active", 10, "x")?.ts).toBe(17);
    expect(findEcho(events, "active", 20, "x")).toBeUndefined();
  });

  it("accepts only terminal append events with their block identity", () => {
    const data = {
      zoneid: "block",
      filename: "term",
      fileop: "append",
      data64: Buffer.from("你好").toString("base64"),
    };
    expect(decodeAppend(JSON.stringify({ data }))).toEqual({ blockId: "block", data: "你好" });
    expect(decodeAppend(JSON.stringify({ data: { ...data, filename: "other" } }))).toBeNull();
    expect(decodeAppend(JSON.stringify({ data: { ...data, fileop: "truncate" } }))).toBeNull();
  });

  it("keeps failed or absent samples out of summaries rather than reporting zero", () => {
    const summary = summarizeReports([
      { throughput: { seconds: null } },
      { throughput: { seconds: 2 } },
      { throughput: { seconds: 4 } },
    ]);
    expect(summary["throughput.seconds"]).toEqual({ samples: 2, median: 3, min: 2, max: 4 });
    expect(summary["keystrokeEchoMs.p95"]).toEqual({ samples: 0, median: null, min: null, max: null });
    expect(percentile([10, 1, 3, 2, 4], 95)).toBe(10);
  });
});
