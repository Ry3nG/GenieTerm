// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const DefaultSysinfoHistoryPoints = 140;
export const MockSysinfoConnection = "local";
export const MockSshConnection = "me@gpu-01";

const MockMemoryTotal = 503;
const MockSwapTotal = 8;
const MockCoreCount = 64;
const MockGpuCount = 8;
const MiB = 1024 * 1024;
const GpuMemTotal = 81559 * MiB;

function clamp(value: number, minValue: number, maxValue: number): number {
    return Math.min(maxValue, Math.max(minValue, value));
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

export function makeMockGpus(step: number): GpuData[] {
    const gpus: GpuData[] = [];
    for (let i = 0; i < MockGpuCount; i++) {
        const idle = i === 7;
        const util = idle ? 0 : clamp(86 + 10 * Math.sin(step / 5 + i) + 3 * Math.cos(step / 2), 40, 100);
        gpus.push({
            index: i,
            name: "NVIDIA H100 80GB HBM3",
            util: round1(util),
            memused: idle ? 4 * MiB : (62000 + i * 900) * MiB,
            memtotal: GpuMemTotal,
            temp: idle ? 31 : Math.round(clamp(62 + util / 6 + (i === 3 ? 12 : 0), 30, 95)),
            power: idle ? 69 : Math.round(clamp(420 + util * 2.4, 60, 700)),
            powerlimit: 700,
            memutil: idle ? 0 : Math.round(clamp(util * 0.4, 0, 100)),
            fan: -1,
            clocksm: idle ? 345 : 1980,
            clocksmmax: 1980,
            clockmem: idle ? 1593 : 2619,
            pstate: idle ? "P8" : "P0",
            processes: idle
                ? []
                : [
                      { pid: 41200 + i, command: "python", user: "me", memused: (61400 + i * 900) * MiB },
                      ...(i === 0
                          ? [
                                { pid: 40990, command: "ray::IDLE", user: "me", memused: 512 * MiB },
                                { pid: 40991, command: "nvidia-cuda-mps-server", user: "root", memused: 30 * MiB },
                            ]
                          : []),
                  ],
        });
    }
    return gpus;
}

export function makeMockSysinfoEvent(
    ts: number,
    step: number,
    scope = MockSysinfoConnection
): Extract<WaveEvent, { event: "sysinfo" }> {
    const baseCpu = clamp(42 + 18 * Math.sin(step / 6) + 8 * Math.cos(step / 3.5), 8, 96);
    const memUsed = clamp(212 + 14 * Math.sin(step / 10) + 4 * Math.cos(step / 7), 60, MockMemoryTotal - 20);
    const values: Record<string, number> = {
        cpu: round1(baseCpu),
        "mem:total": MockMemoryTotal,
        "mem:used": round1(memUsed),
        "mem:free": round1(MockMemoryTotal - memUsed - 120),
        "mem:available": round1(MockMemoryTotal - memUsed),
        "swap:total": MockSwapTotal,
        "swap:used": 0.4,
        "load:1": round1(baseCpu / 3),
        "load:5": round1(baseCpu / 3.2),
        "load:15": round1(baseCpu / 3.5),
        "net:down": Math.round(clamp(42e6 + 30e6 * Math.sin(step / 4), 1e5, 1e9)),
        "net:up": Math.round(clamp(6e6 + 4e6 * Math.cos(step / 5), 1e4, 1e9)),
    };

    for (let i = 0; i < MockCoreCount; i++) {
        const coreCpu = clamp(baseCpu + 30 * Math.sin(step / 4 + i) + (i % 7) * 3 - 9, 0, 100);
        values[`cpu:${i}`] = round1(coreCpu);
    }

    return {
        event: "sysinfo",
        scopes: [scope],
        data: {
            ts,
            values,
            disks: [
                { mount: "/", total: 1788, used: 942, free: 846, percent: 52.7 },
                { mount: "/data", total: 14900, used: 13200, free: 1700, percent: 88.6 },
            ],
            gpus: makeMockGpus(step),
        },
    };
}

export function makeMockSysinfoHistory(
    numPoints = DefaultSysinfoHistoryPoints,
    endTs = Date.now(),
    scope = MockSysinfoConnection
): Extract<WaveEvent, { event: "sysinfo" }>[] {
    const history: Extract<WaveEvent, { event: "sysinfo" }>[] = [];
    const startTs = endTs - (numPoints - 1) * 1000;

    for (let i = 0; i < numPoints; i++) {
        history.push(makeMockSysinfoEvent(startTs + i * 1000, i, scope));
    }

    return history;
}

export const MockHostInfo: HostInfo = {
    hostname: "gpu-01",
    os: "Ubuntu 22.04.4 LTS",
    kernel: "6.5.0-41-generic",
    arch: "amd64",
    cpumodel: "AMD EPYC 9454 48-Core Processor",
    numcpu: MockCoreCount,
    memtotal: MockMemoryTotal * 1024 * 1024 * 1024,
    boottime: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 12,
    gpudriver: "550.54.15",
    cudaversion: "12.4",
};

export const MockListeningPorts: ListeningPortsResponse = {
    platform: "linux",
    partial: true,
    ports: [
        { port: 22, address: "0.0.0.0" },
        { port: 22, address: "::" },
        { port: 53, address: "127.0.0.53" },
        { port: 6006, address: "127.0.0.1", pid: 41320, command: "tensorboard", user: "me" },
        { port: 8265, address: "127.0.0.1", pid: 40980, command: "ray", user: "me" },
        { port: 8888, address: "0.0.0.0", pid: 41011, command: "jupyter-lab", user: "me" },
        { port: 8888, address: "::", pid: 41011, command: "jupyter-lab", user: "me" },
        { port: 5432, address: "127.0.0.1", pid: 1802, command: "postgres", user: "postgres" },
    ],
};

export function makeMockForwards(): PortForwardInfo[] {
    return [
        {
            id: "fwd-tensorboard",
            connname: MockSshConnection,
            remotehost: "127.0.0.1",
            remoteport: 6006,
            localport: 6006,
            status: "active",
            activeconns: 2,
            createdts: Date.now() - 60_000,
        },
        {
            id: "fwd-stale",
            connname: MockSshConnection,
            remotehost: "127.0.0.1",
            remoteport: 3000,
            localport: 3000,
            status: "error",
            error: "nothing is listening on 127.0.0.1:3000 on gpu-01",
            activeconns: 0,
            createdts: Date.now() - 600_000,
        },
    ];
}

export const MockProcesses: ProcessInfo[] = [
    {
        pid: 41200,
        ppid: 41100,
        command: "python",
        user: "me",
        cpu: 99.1,
        mem: 38 * 1024 ** 3,
        mempct: 7.5,
        numthreads: 96,
    },
    {
        pid: 41201,
        ppid: 41100,
        command: "python",
        user: "me",
        cpu: 98.4,
        mem: 37 * 1024 ** 3,
        mempct: 7.3,
        numthreads: 96,
    },
    {
        pid: 41011,
        ppid: 1,
        command: "jupyter-lab",
        user: "me",
        cpu: 1.2,
        mem: 410 * 1024 ** 2,
        mempct: 0.1,
        numthreads: 12,
    },
    {
        pid: 41320,
        ppid: 1,
        command: "tensorboard",
        user: "me",
        cpu: 3.4,
        mem: 1.2 * 1024 ** 3,
        mempct: 0.2,
        numthreads: 40,
    },
    { pid: 40980, ppid: 1, command: "ray", user: "me", cpu: 0.8, mem: 640 * 1024 ** 2, mempct: 0.1, numthreads: 22 },
    {
        pid: 1802,
        ppid: 1,
        command: "postgres",
        user: "postgres",
        cpu: 0.1,
        mem: 96 * 1024 ** 2,
        mempct: 0,
        numthreads: 1,
    },
    { pid: 1, ppid: 0, command: "systemd", user: "root", cpu: 0, mem: 12 * 1024 ** 2, mempct: 0, numthreads: 1 },
];

export function makeMockProcessList(data: CommandRemoteProcessListData): ProcessListResponse {
    const search = (data?.textsearch ?? "").toLowerCase();
    const key = data?.sortby === "mem" ? "mem" : "cpu";
    const processes = MockProcesses.filter(
        (p) => search === "" || p.command.toLowerCase().includes(search) || String(p.pid) === search
    )
        .slice()
        .sort((a, b) => b[key] - a[key])
        .slice(0, data?.limit || MockProcesses.length);
    return {
        processes,
        summary: {
            total: processes.length,
            load1: 5.6,
            load5: 5.2,
            load15: 4.8,
            numcpu: 64,
            memtotal: 503 * 1024 ** 3,
            memused: 226 * 1024 ** 3,
        },
        ts: Date.now(),
        hascpu: true,
        platform: "linux",
        totalcount: MockProcesses.length,
        filteredcount: processes.length,
    };
}
