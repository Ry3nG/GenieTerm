// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { ensureReleaseTag } from "./ensure-release-tag.mjs";
import { getReleasePlan } from "./release-plan.mjs";

const Base = { version: "1.6.0", event: "workflow_dispatch", ref: "refs/heads/main" };
const Dirs = [];
afterEach(() => Dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("release authorization", () => {
  it("keeps manual runs dry by default, even with a tag input", () => {
    for (const ref of [Base.ref, "refs/heads/test", "refs/tags/v1.6.0"]) {
      expect(getReleasePlan({ ...Base, ref, tag: "v1.6.0" })).toEqual({
        tag: "v1.6.0",
        publish: false,
        createTag: false,
      });
    }
  });
  it("permits explicit publication only from main with a matching version", () => {
    expect(getReleasePlan({ ...Base, publish: "true", tag: "v1.6.0" })).toEqual({
      tag: "v1.6.0",
      publish: true,
      createTag: true,
    });
    for (const overrides of [
      { tag: "" },
      { tag: "v1.5.1" },
      { ref: "refs/heads/test" },
      { publish: "yes" },
      { tag: "v1.6.0\npublish=true" },
    ]) {
      expect(() => getReleasePlan({ ...Base, publish: "true", tag: "v1.6.0", ...overrides })).toThrow();
    }
  });
  it("preserves version-checked stable and prerelease tag pushes", () => {
    for (const version of ["1.6.0", "1.6.1-alpha.1", "1.6.1-beta.2"]) {
      expect(getReleasePlan({ ...Base, event: "push", version, ref: `refs/tags/v${version}` })).toEqual({
        tag: `v${version}`,
        publish: true,
        createTag: false,
      });
    }
    expect(() => getReleasePlan({ ...Base, event: "push" })).toThrow();
    expect(() => getReleasePlan({ ...Base, version: "1.6.0-rc.1" })).toThrow();
    expect(() => getReleasePlan({ ...Base, event: "pull_request" })).toThrow();
  });
});

describe("release tag integrity", () => {
  it("tags the verified commit, supports retries, and refuses a different commit", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "genieterm-release-tag-"));
    Dirs.push(cwd);
    const git = (...args) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "--bare", "remote.git");
    git("init", "work");
    const work = path.join(cwd, "work");
    const run = (...args) => git("-C", work, ...args);
    run("config", "user.name", "Release Test");
    run("config", "user.email", "test@example.com");
    run("remote", "add", "origin", path.join(cwd, "remote.git"));
    writeFileSync(path.join(work, "source"), "verified");
    run("add", ".");
    run("commit", "-m", "verified source");
    const sha = run("rev-parse", "HEAD");
    run("commit", "--allow-empty", "-m", "later source");
    const later = run("rev-parse", "HEAD");
    ensureReleaseTag({ tag: "v1.6.0", sha, cwd: work });
    expect(run("rev-parse", "v1.6.0^{}")).toBe(sha);
    expect(run("cat-file", "-t", "v1.6.0")).toBe("tag");
    expect(() => ensureReleaseTag({ tag: "v1.6.0", sha, cwd: work })).not.toThrow();
    expect(() => ensureReleaseTag({ tag: "v1.6.0", sha: later, cwd: work })).toThrow(/does not match/);
    expect(run("ls-remote", "origin", "refs/tags/v1.6.0^{}")).toContain(sha);
    expect(() => ensureReleaseTag({ tag: "--force", sha, cwd: work })).toThrow(/Invalid/);
    run("remote", "set-url", "origin", path.join(cwd, "missing.git"));
    expect(() => ensureReleaseTag({ tag: "v1.6.1", sha, cwd: work })).toThrow(/Cannot inspect/);
    expect(run("tag", "--list", "v1.6.1")).toBe("");
  });
});

it("parallelizes builds while requiring all gates before tag creation and publication", () => {
  const workflow = YAML.parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
  expect(workflow.on.workflow_dispatch.inputs.publish.default).toBe(false);
  const { jobs } = workflow;
  for (const job of ["build-macos", "build-linux", "build-windows"]) {
    expect(jobs[job].needs).toBeUndefined();
  }
  for (const job of ["preflight", "build-macos", "build-linux", "linux-deb-ubuntu-2404", "build-windows"]) {
    expect(jobs.publish.needs).toContain(job);
    expect(jobs.publish.if).toContain(`needs.${job}.result == 'success'`);
  }
  const steps = jobs.publish.steps;
  const verify = steps.findIndex((step) => step.name === "Verify release assets");
  const tag = steps.findIndex((step) => step.name === "Create or verify release tag");
  const publish = steps.findIndex((step) => step.name === "Publish release");
  expect(tag).toBeGreaterThan(verify);
  expect(publish).toBeGreaterThan(tag);
  expect(steps[tag].if).toBe("needs.preflight.outputs.createTag == 'true'");
  expect(steps[publish].if).toBe("needs.preflight.outputs.publish == 'true'");
});
