// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getReleasePlan({ version, event, ref, publish = "false", tag = "" }) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?$/.test(version)) {
    throw new Error(`Unsupported release version: ${version}`);
  }
  const expectedTag = `v${version}`;
  if (event === "push") {
    if (ref !== `refs/tags/${expectedTag}`) {
      throw new Error(`Release tag must match package version ${expectedTag}`);
    }
    return { tag: expectedTag, publish: true, createTag: false };
  }
  if (event !== "workflow_dispatch" || !["", "false", "true"].includes(publish)) {
    throw new Error("Invalid release event or publish input");
  }
  if (tag && tag !== expectedTag) {
    throw new Error(`Release tag must match package version ${expectedTag}`);
  }
  if (publish === "true" && (ref !== "refs/heads/main" || tag !== expectedTag)) {
    throw new Error(`Publishing requires main and the explicit tag ${expectedTag}`);
  }
  return { tag: expectedTag, publish: publish === "true", createTag: publish === "true" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const plan = getReleasePlan({
    version,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    publish: process.env.INPUT_PUBLISH || "false",
    tag: process.env.INPUT_TAG || "",
  });
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(plan)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("")
  );
  console.log(`Release ${plan.tag}: ${plan.publish ? "publish after verification" : "dry run"}`);
}
