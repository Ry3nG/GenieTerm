// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  decodeAppend,
  findEcho,
  hasFinalOutputLine,
  makeOutputLineTracker,
  percentile,
  summarizeReports,
} from "./perf-report.mjs";

describe("performance measurements", () => {
  it("recognizes completion split across packets without mixing terminals", () => {
    const tracker = makeOutputLineTracker("GT_BENCH_DONE");
    tracker.append("first", "1000\r\nGT_BENCH_");
    tracker.append("second", "DONE\r\n");
    expect(tracker.has("first")).toBe(false);
    expect(tracker.has("second")).toBe(false);
    tracker.append("first", "DO");
    tracker.append("first", "NE\r");
    tracker.append("first", "\n$ ");
    expect(tracker.has("first")).toBe(true);
    tracker.append("second", "printf 'GT_BENCH_DONE'\r\n");
    expect(tracker.has("second")).toBe(false);
    tracker.append("second", "GT_BENCH_DONE\r\n" + "output\n".repeat(1000));
    expect(tracker.has("second")).toBe(true);
  });
  it("waits for generated output rather than the echoed throughput command", () => {
    expect(hasFinalOutputLine("$ seq 1 200000\r\n", 200000)).toBe(false);
    expect(hasFinalOutputLine("199999\r\n200000\r\n$ ", 200000)).toBe(true);
    expect(hasFinalOutputLine("200000", 200000)).toBe(false);
  });
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
