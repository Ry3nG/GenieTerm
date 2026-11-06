// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const [label, command, ...args] = process.argv.slice(2);
if (!label || !command) {
  console.error("usage: run-timed.mjs <label> <command> [args...]");
  process.exit(1);
}

console.log(`[timing] started: ${label}`);
const started = performance.now();
const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32" && /^(npm|npx)$/.test(command),
});
const seconds = ((performance.now() - started) / 1000).toFixed(1);
const status = result.status ?? 1;
const summary = `${label}: ${status === 0 ? "passed" : "failed"} (${seconds}s)`;
console.log(`[timing] ${summary}`);
if (result.error) console.error(result.error.message);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${summary}\n`);
}
process.exit(status);
