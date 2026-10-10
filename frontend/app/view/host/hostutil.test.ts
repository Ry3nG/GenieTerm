// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    addressScope,
    canForwardPorts,
    formatGiB,
    formatHostSubtitle,
    formatRate,
    formatUptime,
    forwardStatusText,
    forwardsWithoutListener,
    isLikelyHttp,
    isOutdatedHelperError,
    makePortRows,
    normalizeHostTab,
    parsePortInput,
    pushHistory,
    serviceName,
    summarizeGpus,
    temperatureTone,
    usageTone,
} from "./hostutil";

const Now = Date.UTC(2026, 9, 11, 12, 0, 0);

function forward(partial: Partial<PortForwardInfo>): PortForwardInfo {
    return {
        id: "f1",
        connname: "me@gpu-01",
        remotehost: "127.0.0.1",
        remoteport: 8888,
        localport: 8888,
        status: "active",
        activeconns: 0,
        createdts: Now,
        ...partial,
    };
}

describe("host formatting", () => {
    it("normalizes the stored tab", () => {
        expect(normalizeHostTab("ports")).toBe("ports");
        expect(normalizeHostTab("bogus")).toBe("overview");
        expect(normalizeHostTab(undefined, "processes")).toBe("processes");
    });

    it("formats memory like Activity Monitor", () => {
        expect(formatGiB(12.34)).toBe("12.3 GB");
        expect(formatGiB(503.2)).toBe("503 GB");
        expect(formatGiB(2048)).toBe("2.0 TB");
        expect(formatGiB(NaN)).toBe("—");
    });

    it("formats network rates in decimal units", () => {
        expect(formatRate(512)).toBe("512 B/s");
        expect(formatRate(1800)).toBe("1.8 KB/s");
        expect(formatRate(12_400_000)).toBe("12.4 MB/s");
        expect(formatRate(-1)).toBe("—");
    });

    it("formats uptime at a useful precision", () => {
        const boot = (min: number) => Now / 1000 - min * 60;
        expect(formatUptime(boot(42), Now)).toBe("up 42 min");
        expect(formatUptime(boot(200), Now)).toBe("up 3 h 20 min");
        expect(formatUptime(boot(60 * 30), Now)).toBe("up 1 day 6 h");
        expect(formatUptime(boot(60 * 24 * 12 + 5), Now)).toBe("up 12 days");
        expect(formatUptime(0, Now)).toBe("");
    });

    it("builds a one-line host subtitle", () => {
        const info: HostInfo = {
            hostname: "gpu-01",
            os: "Ubuntu 22.04.4 LTS",
            kernel: "6.5.0-41-generic",
            arch: "amd64",
            numcpu: 64,
            memtotal: 512 * 1024 * 1024 * 1024,
            boottime: Now / 1000 - 60 * 60 * 24 * 12,
        };
        expect(formatHostSubtitle(info, Now)).toBe("Ubuntu 22.04.4 LTS · 64 cores · 512 GB · up 12 days");
    });

    it("grades usage and temperature", () => {
        expect(usageTone(42)).toBe("normal");
        expect(usageTone(75)).toBe("warning");
        expect(usageTone(95)).toBe("error");
        expect(usageTone(-1)).toBe("none");
        expect(temperatureTone(65)).toBe("normal");
        expect(temperatureTone(80)).toBe("warning");
        expect(temperatureTone(91)).toBe("error");
    });

    it("summarizes identical GPUs", () => {
        const gpu = (index: number, name: string) =>
            ({ index, name, util: 0, memused: 0, memtotal: 0, temp: 0, power: 0, powerlimit: 0 }) as GpuData;
        expect(summarizeGpus([gpu(0, "H100"), gpu(1, "H100")])).toBe("2 × H100");
        expect(summarizeGpus([gpu(0, "A100"), gpu(1, "T4")])).toBe("A100, T4");
        expect(summarizeGpus([])).toBe("");
    });

    it("keeps a bounded history", () => {
        const h = pushHistory([1, 2, 3], 4, 3);
        expect(h).toEqual([2, 3, 4]);
        expect(Number.isNaN(pushHistory([], -1)[0])).toBe(true);
    });
});

describe("ports", () => {
    it("describes bind addresses", () => {
        expect(addressScope("127.0.0.1").kind).toBe("local");
        expect(addressScope("::1").kind).toBe("local");
        expect(addressScope("0.0.0.0").kind).toBe("all");
        expect(addressScope("::").kind).toBe("all");
        expect(addressScope("10.0.0.5")).toEqual({ kind: "specific", label: "10.0.0.5" });
    });

    it("recognizes common services", () => {
        expect(serviceName(8888, "jupyter-lab")).toBe("Jupyter");
        expect(serviceName(9999, "tensorboard")).toBe("TensorBoard");
        expect(serviceName(8888, "python3")).toBe("Jupyter");
        expect(serviceName(4321, "node")).toBe("");
        expect(isLikelyHttp(5432, "postgres")).toBe(false);
        expect(isLikelyHttp(3000, "node")).toBe(true);
    });

    it("merges IPv4 and IPv6 binds of one server into a row", () => {
        const rows = makePortRows(
            [
                { port: 8888, address: "0.0.0.0", pid: 10, command: "jupyter-lab", user: "me" },
                { port: 8888, address: "::", pid: 10, command: "jupyter-lab", user: "me" },
                { port: 22, address: "0.0.0.0" },
                { port: 6006, address: "127.0.0.1", pid: 11, command: "tensorboard", user: "me" },
            ],
            [forward({ remoteport: 6006, localport: 6007 })]
        );
        expect(rows.map((r) => r.port)).toEqual([6006, 8888, 22]);
        expect(rows[1].addresses).toEqual(["0.0.0.0", "::"]);
        expect(rows[1].scope.kind).toBe("all");
        expect(rows[0].scope.kind).toBe("local");
        expect(rows[0].forward?.localport).toBe(6007);
        expect(rows[2].service).toBe("SSH");
    });

    it("lists forwards whose remote port is no longer listening", () => {
        const rows = makePortRows([{ port: 8888, address: "127.0.0.1", pid: 1, command: "jupyter" }], []);
        const stale = forwardsWithoutListener(rows, [
            forward({ id: "a", remoteport: 8888 }),
            forward({ id: "b", remoteport: 3000 }),
        ]);
        expect(stale.map((f) => f.id)).toEqual(["b"]);
    });

    it("explains forward status", () => {
        expect(forwardStatusText(forward({}))).toBe("Forwarding");
        expect(forwardStatusText(forward({ activeconns: 3 }))).toBe("3 connections");
        expect(forwardStatusText(forward({ status: "waiting" }))).toBe("Waiting for connection");
        expect(forwardStatusText(forward({ status: "error", error: "nothing is listening" }))).toBe(
            "Nothing is listening"
        );
    });

    it("parses port input strictly", () => {
        expect(parsePortInput(" 8080 ")).toBe(8080);
        expect(parsePortInput("0")).toBe(0);
        expect(parsePortInput("65536")).toBe(0);
        expect(parsePortInput("80a")).toBe(0);
    });

    it("only forwards over SSH", () => {
        expect(canForwardPorts("local")).toBe(false);
        expect(canForwardPorts("")).toBe(false);
        expect(canForwardPorts("wsl://Ubuntu")).toBe(false);
        expect(canForwardPorts("me@gpu-01")).toBe(true);
    });

    it("spots an outdated remote helper", () => {
        expect(isOutdatedHelperError("rpc error: command not found: remotelisteningports")).toBe(true);
        expect(isOutdatedHelperError("permission denied")).toBe(false);
    });
});
