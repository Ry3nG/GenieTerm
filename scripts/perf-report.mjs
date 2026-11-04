// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (p === 50 && sorted.length % 2 === 0) {
    return Number(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2).toFixed(2));
  }
  return Number(sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(2));
}

export function summarizeReports(reports) {
  const metrics = [
    "idle.totalFootprintMB",
    "withTabsSettled.totalFootprintMB",
    "keystrokeEchoMs.p50",
    "keystrokeEchoMs.p95",
    "busyKeystrokeEchoMs.p95",
    "throughput.seconds",
    "relaunchToWindowMs",
    "relaunchToTerminalMs",
  ];
  return Object.fromEntries(
    metrics.map((key) => {
      const values = reports
        .map((report) => key.split(".").reduce((value, part) => value?.[part], report))
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      return [
        key,
        {
          samples: values.length,
          median: percentile(values, 50),
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
        },
      ];
    })
  );
}

export function decodeAppend(payload) {
  if (!payload.includes('"fileop":"append"')) return null;
  const b64 = payload.match(/"data64":"([^"]*)"/)?.[1];
  const blockId = payload.match(/"zoneid":"([^"]*)"/)?.[1];
  const filename = payload.match(/"filename":"([^"]*)"/)?.[1];
  if (b64 == null || !blockId || filename !== "term") return null;
  return { blockId, data: Buffer.from(b64, "base64").toString("utf8") };
}

export function findEcho(received, blockId, sentAt, marker) {
  return received.find((event) => event.blockId === blockId && event.ts >= sentAt && event.data.includes(marker));
}

export function hasFinalOutputLine(text, lines) {
  return new RegExp(`(?:^|[\\r\\n])${lines}\\r?\\n`).test(text);
}
