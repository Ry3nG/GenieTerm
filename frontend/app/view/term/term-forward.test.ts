// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    findLocalUrls,
    LocalUrlScanner,
    makeLocalForwardUrl,
    parseLocalUrl,
    TermForwardModel,
    type TermForwardHost,
} from "./term-forward";

const enc = new TextEncoder();

describe("parseLocalUrl", () => {
    it("reads the loopback forms servers print", () => {
        expect(parseLocalUrl("http://localhost:6006/")).toMatchObject({
            remoteHost: "127.0.0.1",
            port: 6006,
            rest: "/",
        });
        expect(parseLocalUrl("http://127.0.0.1:8888/lab?token=abc")).toMatchObject({
            port: 8888,
            rest: "/lab?token=abc",
        });
        expect(parseLocalUrl("http://0.0.0.0:7860")).toMatchObject({ remoteHost: "127.0.0.1", port: 7860, rest: "/" });
        expect(parseLocalUrl("http://[::1]:3000/x")).toMatchObject({ remoteHost: "::1", port: 3000 });
        expect(parseLocalUrl("https://localhost/")).toMatchObject({ protocol: "https:", port: 443 });
    });

    it("drops trailing punctuation from prose", () => {
        expect(parseLocalUrl("http://127.0.0.1:8000/)")).toMatchObject({ port: 8000, rest: "/" });
        expect(parseLocalUrl("http://localhost:5173/.")).toMatchObject({ port: 5173, rest: "/" });
    });

    it("ignores other hosts", () => {
        expect(parseLocalUrl("http://example.com:8080/")).toBeNull();
        expect(parseLocalUrl("http://10.0.0.2:8080/")).toBeNull();
        expect(parseLocalUrl("http://localhost.evil.com/")).toBeNull();
    });
});

describe("findLocalUrls", () => {
    it("finds URLs in real server banners", () => {
        const vite = "  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose\n";
        expect(findLocalUrls(vite).map((f) => f.url.port)).toEqual([5173]);
        const py = "Serving HTTP on 127.0.0.1 port 8000 (http://127.0.0.1:8000/) ...\n";
        expect(findLocalUrls(py).map((f) => f.url.url)).toEqual(["http://127.0.0.1:8000/"]);
        const tb = "TensorBoard 2.17.0 at http://localhost:6006/ (Press CTRL+C to quit)\n";
        expect(findLocalUrls(tb).map((f) => f.url.port)).toEqual([6006]);
    });
});

describe("makeLocalForwardUrl", () => {
    it("keeps the path and token on the forwarded port", () => {
        const url = parseLocalUrl("http://127.0.0.1:8888/lab?token=abc#x");
        expect(makeLocalForwardUrl(url, 50123)).toBe("http://localhost:50123/lab?token=abc#x");
    });
});

describe("LocalUrlScanner", () => {
    it("skips chunks without a URL", () => {
        const s = new LocalUrlScanner();
        expect(s.feed(enc.encode("epoch 12 loss 0.31\n"))).toEqual([]);
    });

    it("strips color codes", () => {
        const s = new LocalUrlScanner();
        const urls = s.feed(enc.encode("\x1b[1mLocal:\x1b[0m \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n"));
        expect(urls.map((u) => u.port)).toEqual([5173]);
    });

    it("joins a URL split across chunks", () => {
        const s = new LocalUrlScanner();
        expect(s.feed(enc.encode("running at http://local"))).toEqual([]);
        expect(s.feed(enc.encode("host:80"))).toEqual([]);
        expect(s.feed(enc.encode("00/\n")).map((u) => u.port)).toEqual([8000]);
    });

    it("splits inside the scheme separator", () => {
        const s = new LocalUrlScanner();
        expect(s.feed(enc.encode("at http:/"))).toEqual([]);
        expect(s.feed(enc.encode("/127.0.0.1:9000/ ok\n")).map((u) => u.port)).toEqual([9000]);
    });
});

function makeHost(overrides: Partial<TermForwardHost> = {}) {
    const state = { running: 7 as number | null | undefined, opened: [] as string[] };
    const host: TermForwardHost = {
        getConnName: () => "me@gpu-box",
        offerEnabled: () => true,
        getRunningCmdBlockId: () => state.running,
        startForward: vi.fn(async (data) => ({
            id: "f1",
            connname: data.connname,
            remotehost: data.remotehost,
            remoteport: data.remoteport,
            localport: 6006,
            status: "active",
            activeconns: 0,
            createdts: 0,
        })),
        listForwards: vi.fn(async () => []),
        openUrl: (url) => state.opened.push(url),
        ...overrides,
    };
    return { host, state };
}

describe("TermForwardModel", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("offers a URL printed by a command that keeps running", async () => {
        const { host } = makeHost();
        const m = new TermForwardModel(host);
        m.noteUrls([parseLocalUrl("http://localhost:6006/")]);
        expect(m.getOffer()).toBeNull();
        await vi.advanceTimersByTimeAsync(1000);
        expect(m.getOffer()).toMatchObject({ status: "offer", blockId: 7, connName: "me@gpu-box" });
    });

    it("doesn't offer when the command already exited", async () => {
        const { host, state } = makeHost();
        const m = new TermForwardModel(host);
        m.noteUrls([parseLocalUrl("http://localhost:5432/")]);
        state.running = null;
        await vi.advanceTimersByTimeAsync(1000);
        expect(m.getOffer()).toBeNull();
    });

    it("doesn't offer on local terminals or when turned off", async () => {
        const local = new TermForwardModel(makeHost({ getConnName: () => "local" }).host);
        local.noteUrls([parseLocalUrl("http://localhost:6006/")]);
        const off = new TermForwardModel(makeHost({ offerEnabled: () => false }).host);
        off.noteUrls([parseLocalUrl("http://localhost:6006/")]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(local.getOffer()).toBeNull();
        expect(off.getOffer()).toBeNull();
    });

    it("forwards and opens the same path on this computer", async () => {
        const { host, state } = makeHost({
            startForward: vi.fn(async (data) => ({
                id: "f1",
                connname: data.connname,
                remotehost: data.remotehost,
                remoteport: data.remoteport,
                localport: 50123,
                status: "active",
                activeconns: 0,
                createdts: 0,
            })),
        });
        const m = new TermForwardModel(host);
        m.noteUrls([parseLocalUrl("http://127.0.0.1:8888/lab?token=abc")]);
        await vi.advanceTimersByTimeAsync(1000);
        await m.open();
        expect(host.startForward).toHaveBeenCalledWith({
            connname: "me@gpu-box",
            remotehost: "127.0.0.1",
            remoteport: 8888,
            localport: 0,
        });
        expect(state.opened).toEqual(["http://localhost:50123/lab?token=abc"]);
        expect(m.getOffer()).toMatchObject({ status: "forwarded", localPort: 50123 });
        await vi.advanceTimersByTimeAsync(9000);
        expect(m.getOffer()).toBeNull();
    });

    it("shows an existing forward instead of offering a new one", async () => {
        const { host } = makeHost({
            listForwards: vi.fn(async () => [
                {
                    id: "f0",
                    connname: "me@gpu-box",
                    remotehost: "127.0.0.1",
                    remoteport: 6006,
                    localport: 16006,
                    status: "active",
                    activeconns: 1,
                    createdts: 0,
                },
            ]),
        });
        const m = new TermForwardModel(host);
        m.noteUrls([parseLocalUrl("http://localhost:6006/")]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(m.getOffer()).toMatchObject({ status: "forwarded", localPort: 16006 });
    });

    it("stays quiet after a dismiss and goes away when the server exits", async () => {
        const { host, state } = makeHost();
        const m = new TermForwardModel(host);
        m.noteUrls([parseLocalUrl("http://localhost:6006/")]);
        await vi.advanceTimersByTimeAsync(1000);
        m.dismiss();
        m.noteUrls([parseLocalUrl("http://localhost:6006/")]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(m.getOffer()).toBeNull();

        m.noteUrls([parseLocalUrl("http://localhost:7860/")]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(m.getOffer()?.url.port).toBe(7860);
        state.running = null;
        m.noteRunningCmdBlock(null);
        expect(m.getOffer()).toBeNull();
    });

    it("shows the error and lets you retry", async () => {
        const { host } = makeHost({
            startForward: vi.fn(async () => {
                throw new Error("local port 6006 is in use");
            }),
        });
        const m = new TermForwardModel(host);
        m.noteUrls([parseLocalUrl("http://localhost:6006/")]);
        await vi.advanceTimersByTimeAsync(1000);
        await m.open();
        expect(m.getOffer()).toMatchObject({ status: "error", error: "local port 6006 is in use" });
    });

    it("routes cmd-click on a remote loopback URL through a forward", async () => {
        const { host, state } = makeHost();
        const m = new TermForwardModel(host);
        expect(m.openLink("https://example.com/")).toBe(false);
        expect(m.openLink("http://localhost:6006/#scalars")).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(state.opened).toEqual(["http://localhost:6006/#scalars"]);
        const local = new TermForwardModel(makeHost({ getConnName: () => "local" }).host);
        expect(local.openLink("http://localhost:6006/")).toBe(false);
    });
});
