---
name: release
description: Prepare and publish a GenieTerm version, or resume an unfinished release through public downloads and update-feed verification. Use for requests to ship a fix or finish a product release; pushing code alone is not publication.
---

# Release GenieTerm

Read [docs/releasing.md](../../../docs/releasing.md) before acting. It is the source of truth for supported platforms, checks, signing and publication commands. A request to investigate or edit release tooling does not authorize a product release.

- Inspect the working tree, remote main, current version and existing releases. Preserve unrelated work. If the requested version already exists, verify it or resume its unfinished post-publication checks rather than rebuilding or replacing it.
- Prepare the fix, version bump, release notes and version-matched What's New entry together before the release push. Run the documented local release check on that final candidate. Reuse a completed check only while its source tree, version and build inputs are unchanged.
- Commit and push the candidate once where practical. Record its full SHA and check CI for that SHA, including Windows tests and packaged performance. Do not treat a green parent commit as a green release candidate. Local checks and CI can run concurrently; both must pass before publication.
- Dispatch the documented one-pass publication once, with an explicit matching tag. Confirm the returned run's `headSha` is the candidate. Use `gh run watch <run-id> --exit-status --interval 30` to follow it; inspect job logs on failure rather than repeatedly querying all runs. Report meaningful progress and do not dispatch duplicates while waiting.
- A dry run is optional, not an extra prerequisite to every release. On failure, identify the failing job and reuse successful jobs when retrying the same run and source. A changed source needs a new candidate. Never overwrite a published release or move its tag.
- Complete the public download, checksum, launch and update-feed checks in the release guide. Distinguish the What's New marker smoke from a real previous-version migration or updater installation; do not claim coverage that was not exercised.
- After a stable release is public, synchronize and verify the website's default version and download links against its actual assets. Follow the site's deployment instructions in the release guide. Prereleases must not replace stable downloads.

Keep a short record in the chat of candidate SHA/tag, local check result, CI and Release run links, and completed public/website checks. Resume from the first missing result. Report completion only when the requested version is public and the required post-publication checks are done; a push, successful build or draft Release is not the finished product.
