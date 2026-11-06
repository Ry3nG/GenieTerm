// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const Runner = fileURLToPath(new URL("./run-timed.mjs", import.meta.url));
const Dirs = [];
afterEach(() => Dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), "genieterm timing "));
  Dirs.push(cwd);
  const summary = path.join(cwd, "summary.md");
  const run = (...args) =>
    spawnSync(process.execPath, [Runner, "Build probe", ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
  return { cwd, summary, run };
}

describe("timed build commands", () => {
  it("preserves arguments and appends successful timing evidence", () => {
    const { cwd, summary, run } = fixture();
    const script = path.join(cwd, "probe with spaces.mjs");
    writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)))");
    writeFileSync(summary, "Existing evidence\n");
    const args = ["path with spaces", "literal $value & text"];
    const result = run(process.execPath, script, ...args);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(JSON.stringify(args));
    expect(readFileSync(summary, "utf8")).toMatch(/^Existing evidence\n- Build probe: passed \(\d+\.\d+s\)\n$/);
  });

  it("propagates failure instead of letting packaging continue", () => {
    const { cwd, summary, run } = fixture();
    const script = path.join(cwd, "fail.mjs");
    writeFileSync(script, "console.error('build failed'); process.exit(7)");
    const result = run(process.execPath, script);
    expect(result.status).toBe(7);
    expect(result.stderr).toContain("build failed");
    expect(readFileSync(summary, "utf8")).toContain("Build probe: failed");
  });

  it("fails when the executable cannot start", () => {
    const { run } = fixture();
    expect(run("genieterm-missing-build-command").status).toBe(1);
  });

  it("runs npm and preserves its failure on Windows as well as Unix", () => {
    const { cwd, run } = fixture();
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "timing-probe", private: true }));
    expect(run("npm", "--version").status).toBe(0);
    const result = run("npm", "run", "missing-build-script");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Build probe: failed");
  });
});
