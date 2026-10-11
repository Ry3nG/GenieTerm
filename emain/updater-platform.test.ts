// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import semver from "semver";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
    checkPackageFeed,
    type FeedResponse,
    type PackageFeedDeps,
    usesPackageManagerUpdates,
} from "./updater-platform";

describe("updater platform", () => {
    it("leaves .deb installs to the package manager and updates AppImages itself", () => {
        expect(usesPackageManagerUpdates("linux", {})).toBe(true);
        expect(usesPackageManagerUpdates("linux", { APPIMAGE: "/home/me/GenieTerm.AppImage" })).toBe(false);
        expect(usesPackageManagerUpdates("darwin", {})).toBe(false);
        expect(usesPackageManagerUpdates("win32", {})).toBe(false);
    });
});

const manifest = (version: string) => `version: ${version}\nreleaseName: GenieTerm ${version}\nfiles: []\n`;
const ok = (text: string): FeedResponse => ({ ok: true, status: 200, text: async () => text });

function makeFeed(responses: Array<() => Promise<FeedResponse>>, initial: UpdaterStatus = "up-to-date") {
    let status = initial;
    const statuses: UpdaterStatus[] = [];
    const urls: string[] = [];
    let available: { version: string } = null;
    const deps: PackageFeedDeps = {
        fetch: async (url) => {
            urls.push(url);
            return responses.shift()();
        },
        parseManifest: (text) => YAML.parse(text),
        isNewer: (version, current) => semver.gt(version, current),
        isValidVersion: (version) => typeof version == "string" && semver.valid(version) != null,
        feedUrl: "https://example.test/feed/",
        arch: "x64",
        currentVersion: "1.1.0",
        getStatus: () => status,
        setStatus: (next) => {
            status = next;
            statuses.push(next);
        },
        onUpdateAvailable: (info) => {
            available = info;
        },
    };
    return { deps, statuses, urls, status: () => status, available: () => available };
}

describe("package feed check", () => {
    it.each([
        ["offline", () => Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED"))],
        ["an HTTP error", () => Promise.resolve({ ok: false, status: 503, text: async () => "" })],
        ["an unparsable manifest", () => Promise.resolve(ok("version: [unterminated"))],
        ["a manifest without a version", () => Promise.resolve(ok("files: []\n"))],
    ])("recovers from %s so the next check retries", async (_label, failure) => {
        const feed = makeFeed([failure, () => Promise.resolve(ok(manifest("1.2.0")))]);
        await expect(checkPackageFeed(feed.deps)).rejects.toThrow();
        expect(feed.status()).not.toBe("checking");
        expect(feed.status()).toBe("error");
        await expect(checkPackageFeed(feed.deps)).resolves.toEqual({ isUpdateAvailable: true });
        expect(feed.status()).toBe("manual");
        expect(feed.available().version).toBe("1.2.0");
        expect(feed.urls).toHaveLength(2);
    });

    it("keeps a known update visible when a later check fails", async () => {
        const feed = makeFeed([() => Promise.reject(new Error("offline"))], "manual");
        await expect(checkPackageFeed(feed.deps)).rejects.toThrow("offline");
        expect(feed.status()).toBe("manual");
        expect(feed.statuses).not.toContain("checking");
    });

    it("reports up to date for the same or an older release", async () => {
        const feed = makeFeed([() => Promise.resolve(ok(manifest("1.1.0")))]);
        await expect(checkPackageFeed(feed.deps)).resolves.toEqual({ isUpdateAvailable: false });
        expect(feed.status()).toBe("up-to-date");
        expect(feed.available()).toBeNull();
    });

    it("reads the manifest for the machine's architecture", async () => {
        const feed = makeFeed([() => Promise.resolve(ok(manifest("1.2.0")))]);
        feed.deps.arch = "arm64";
        await checkPackageFeed(feed.deps);
        expect(feed.urls[0]).toBe("https://example.test/feed/latest-linux-arm64.yml");
    });
});
