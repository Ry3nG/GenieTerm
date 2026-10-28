// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function ensureReleaseTag({ tag, sha, cwd = process.cwd() }) {
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?$/.test(tag) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("Invalid release tag or commit");
  }
  const ref = `refs/tags/${tag}`;
  const remote = spawnSync("git", ["ls-remote", "--exit-code", "origin", ref, `${ref}^{}`], { cwd, encoding: "utf8" });
  if (remote.status === 0) {
    const refs = new Map(
      remote.stdout
        .trim()
        .split("\n")
        .map((line) => line.split(/\s+/).reverse())
    );
    if ((refs.get(`${ref}^{}`) || refs.get(ref)) !== sha) {
      throw new Error(`Existing tag ${tag} does not match verified commit ${sha}`);
    }
    return;
  }
  if (remote.status !== 2) {
    throw new Error(`Cannot inspect release tag: ${remote.stderr || remote.error}`);
  }
  const git = (args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git([
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "tag",
    "-a",
    tag,
    sha,
    "-m",
    `GenieTerm ${tag.slice(1)}`,
  ]);
  // GITHUB_TOKEN pushes do not trigger another release build. Never force an existing tag.
  git(["push", "origin", `${ref}:${ref}`]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureReleaseTag({ tag: process.env.TAG_NAME, sha: process.env.GITHUB_SHA });
}
