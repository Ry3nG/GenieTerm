// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type HostTab = "overview" | "processes" | "ports";

export const HostTabs: HostTab[] = ["overview", "processes", "ports"];

export const HostHistoryLength = 60;

const GiB = 1024 * 1024 * 1024;

export function normalizeHostTab(value: unknown, fallback: HostTab = "overview"): HostTab {
    if (value === "overview" || value === "processes" || value === "ports") {
        return value;
    }
    return fallback;
}

export function isLocalConnName(conn: string): boolean {
    return conn == null || conn === "" || conn === "local" || conn.startsWith("local:");
}

export function isWslConnName(conn: string): boolean {
    return conn != null && conn.startsWith("wsl://");
}

export function canForwardPorts(conn: string): boolean {
    return !isLocalConnName(conn) && !isWslConnName(conn);
}

export function isValidNumber(value: number): boolean {
    return value != null && Number.isFinite(value) && value >= 0;
}

export function clampPct(value: number): number {
    if (!isValidNumber(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, value));
}

export function formatPct(value: number): string {
    if (!isValidNumber(value)) {
        return "—";
    }
    return `${Math.round(value)}%`;
}

// Sysinfo memory and disk values arrive in GiB; one decimal below 100 reads like Activity Monitor.
export function formatGiB(gib: number): string {
    if (!isValidNumber(gib)) {
        return "—";
    }
    if (gib >= 1024) {
        return `${(gib / 1024).toFixed(1)} TB`;
    }
    if (gib >= 100) {
        return `${Math.round(gib)} GB`;
    }
    return `${gib.toFixed(1)} GB`;
}

export function formatBytesAsGiB(bytes: number): string {
    if (!isValidNumber(bytes)) {
        return "—";
    }
    return formatGiB(bytes / GiB);
}

export function formatRate(bytesPerSec: number): string {
    if (!isValidNumber(bytesPerSec)) {
        return "—";
    }
    if (bytesPerSec < 1000) {
        return `${Math.round(bytesPerSec)} B/s`;
    }
    if (bytesPerSec < 1000 * 1000) {
        return `${(bytesPerSec / 1000).toFixed(1)} KB/s`;
    }
    if (bytesPerSec < 1000 * 1000 * 1000) {
        return `${(bytesPerSec / 1000 / 1000).toFixed(1)} MB/s`;
    }
    return `${(bytesPerSec / 1000 / 1000 / 1000).toFixed(2)} GB/s`;
}

export function formatUptime(bootTimeSec: number, nowMs: number): string {
    if (!bootTimeSec || bootTimeSec <= 0) {
        return "";
    }
    const totalMin = Math.max(0, Math.floor((nowMs / 1000 - bootTimeSec) / 60));
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    const minutes = totalMin % 60;
    if (days >= 2) {
        return `up ${days} days`;
    }
    if (days === 1) {
        return hours > 0 ? `up 1 day ${hours} h` : "up 1 day";
    }
    if (hours > 0) {
        return `up ${hours} h ${minutes} min`;
    }
    return `up ${minutes} min`;
}

export function formatHostSubtitle(info: HostInfo, nowMs: number): string {
    if (info == null) {
        return "";
    }
    const parts: string[] = [];
    if (info.os) {
        parts.push(info.os);
    }
    if (info.numcpu > 0) {
        parts.push(`${info.numcpu} ${info.numcpu === 1 ? "core" : "cores"}`);
    }
    if (info.memtotal > 0) {
        parts.push(formatBytesAsGiB(info.memtotal).replace(".0 GB", " GB"));
    }
    const uptime = formatUptime(info.boottime, nowMs);
    if (uptime) {
        parts.push(uptime);
    }
    return parts.join(" · ");
}

export function usageTone(pct: number): "normal" | "warning" | "error" | "none" {
    if (!isValidNumber(pct)) {
        return "none";
    }
    if (pct >= 90) {
        return "error";
    }
    if (pct >= 70) {
        return "warning";
    }
    return "normal";
}

export function temperatureTone(celsius: number): "normal" | "warning" | "error" | "none" {
    if (!isValidNumber(celsius)) {
        return "none";
    }
    if (celsius >= 88) {
        return "error";
    }
    if (celsius >= 78) {
        return "warning";
    }
    return "normal";
}

export type AddressScope = { kind: "local" | "all" | "specific"; label: string };

export function addressScope(address: string): AddressScope {
    if (address === "127.0.0.1" || address === "::1" || address === "localhost" || address?.startsWith("127.")) {
        return { kind: "local", label: "Localhost only" };
    }
    if (address === "0.0.0.0" || address === "::" || address === "*" || address === "") {
        return { kind: "all", label: "All interfaces" };
    }
    return { kind: "specific", label: address };
}

const ServiceByCommand: Array<[RegExp, string]> = [
    [/^jupyter|jupyter-lab|jupyter-notebook/i, "Jupyter"],
    [/tensorboard/i, "TensorBoard"],
    [/^code-server|^code$|vscode-server/i, "VS Code Server"],
    [/^sshd/i, "SSH"],
    [/^postgres/i, "PostgreSQL"],
    [/^mysqld|^mariadbd/i, "MySQL"],
    [/^redis-server/i, "Redis"],
    [/^mongod/i, "MongoDB"],
    [/^nginx/i, "nginx"],
    [/^httpd|^apache2/i, "Apache"],
    [/^ollama/i, "Ollama"],
    [/^prometheus/i, "Prometheus"],
    [/^grafana/i, "Grafana"],
    [/^docker-proxy/i, "Docker"],
    [/^streamlit/i, "Streamlit"],
    [/^vite/i, "Vite"],
    [/^ray/i, "Ray"],
];

const ServiceByPort: Record<number, string> = {
    22: "SSH",
    53: "DNS",
    111: "rpcbind",
    631: "Printing",
    3306: "MySQL",
    5173: "Vite",
    5432: "PostgreSQL",
    6006: "TensorBoard",
    6379: "Redis",
    7860: "Gradio",
    8265: "Ray Dashboard",
    8501: "Streamlit",
    8888: "Jupyter",
    9090: "Prometheus",
    11434: "Ollama",
    27017: "MongoDB",
};

const NonHttpServices = new Set(["SSH", "DNS", "rpcbind", "PostgreSQL", "MySQL", "Redis", "MongoDB", "Printing"]);
const SystemServices = new Set(["SSH", "DNS", "rpcbind", "Printing"]);

export function serviceName(port: number, command: string): string {
    const cmd = (command ?? "").trim();
    for (const [pattern, name] of ServiceByCommand) {
        if (cmd && pattern.test(cmd)) {
            return name;
        }
    }
    return ServiceByPort[port] ?? "";
}

export function isLikelyHttp(port: number, command: string): boolean {
    const service = serviceName(port, command);
    return !NonHttpServices.has(service);
}

// Forwarding the host's own SSH or DNS port to this machine is never what someone wants.
export function isForwardable(port: number, command: string): boolean {
    return !SystemServices.has(serviceName(port, command));
}

export function formatGpuMemory(usedBytes: number, totalBytes: number): string {
    if (!isValidNumber(usedBytes) || !isValidNumber(totalBytes)) {
        return "—";
    }
    const used = usedBytes / GiB;
    const total = totalBytes / GiB;
    return `${used.toFixed(1)}/${total.toFixed(total >= 100 ? 0 : 1)} GB`;
}

// GenieTerm's own servers and OS daemons are rarely what someone opens the Ports tab for.
const OwnServerCommand = /^(wavesrv|genieterm|wsh|genie)\b/i;
const SystemDaemons = new Set([
    "ARDAgent",
    "ControlCenter",
    "rapportd",
    "sharingd",
    "remoted",
    "identityservicesd",
    "AirPlayXPCHelper",
    "mDNSResponder",
    "cupsd",
    "launchd",
    "systemd",
    "systemd-resolved",
    "systemd-resolve",
    "rpcbind",
    "chronyd",
    "avahi-daemon",
]);
const EphemeralPortStart = 49152;

export function isBackgroundListener(row: PortRow): boolean {
    if (row.forward != null) {
        return false;
    }
    if (OwnServerCommand.test(row.command) || SystemDaemons.has(row.command)) {
        return true;
    }
    if (row.service === "SSH" || row.service === "DNS" || row.service === "rpcbind" || row.service === "Printing") {
        return true;
    }
    return row.port >= EphemeralPortStart;
}

export type PortRow = {
    key: string;
    port: number;
    addresses: string[];
    scope: AddressScope;
    pid: number;
    command: string;
    user: string;
    service: string;
    forward: PortForwardInfo;
};

function mergeScope(addresses: string[]): AddressScope {
    const scopes = addresses.map(addressScope);
    if (scopes.some((s) => s.kind === "all")) {
        return { kind: "all", label: "All interfaces" };
    }
    if (scopes.every((s) => s.kind === "local")) {
        return { kind: "local", label: "Localhost only" };
    }
    const specific = scopes.find((s) => s.kind === "specific");
    return specific ?? scopes[0] ?? { kind: "all", label: "All interfaces" };
}

// One row per (port, owner): the same server usually binds both 0.0.0.0 and ::.
export function makePortRows(ports: ListeningPort[], forwards: PortForwardInfo[]): PortRow[] {
    const byKey = new Map<string, PortRow>();
    for (const p of ports ?? []) {
        const key = `${p.port}:${p.pid ?? 0}`;
        const existing = byKey.get(key);
        if (existing) {
            if (!existing.addresses.includes(p.address)) {
                existing.addresses.push(p.address);
            }
            continue;
        }
        byKey.set(key, {
            key,
            port: p.port,
            addresses: [p.address],
            scope: null,
            pid: p.pid ?? 0,
            command: p.command ?? "",
            user: p.user ?? "",
            service: serviceName(p.port, p.command),
            forward: null,
        });
    }
    const rows = [...byKey.values()];
    for (const row of rows) {
        row.scope = mergeScope(row.addresses);
        row.forward = (forwards ?? []).find((f) => f.remoteport === row.port) ?? null;
    }
    rows.sort((a, b) => {
        const aKnown = a.command ? 0 : 1;
        const bKnown = b.command ? 0 : 1;
        if (aKnown !== bKnown) {
            return aKnown - bKnown;
        }
        return a.port - b.port;
    });
    return rows;
}

export function forwardsWithoutListener(rows: PortRow[], forwards: PortForwardInfo[]): PortForwardInfo[] {
    const listening = new Set(rows.map((r) => r.port));
    return (forwards ?? []).filter((f) => !listening.has(f.remoteport));
}

export function forwardUrl(forward: PortForwardInfo): string {
    return `http://localhost:${forward.localport}`;
}

export function forwardStatusText(forward: PortForwardInfo): string {
    if (forward.status === "active") {
        if (forward.activeconns > 0) {
            return `${forward.activeconns} ${forward.activeconns === 1 ? "connection" : "connections"}`;
        }
        return "Forwarding";
    }
    if (forward.status === "waiting") {
        return "Waiting for connection";
    }
    const error = forward.error || "Failed";
    return error.charAt(0).toUpperCase() + error.slice(1);
}

export function parsePortInput(value: string): number {
    const trimmed = (value ?? "").trim();
    if (!/^\d{1,5}$/.test(trimmed)) {
        return 0;
    }
    const port = Number(trimmed);
    if (port < 1 || port > 65535) {
        return 0;
    }
    return port;
}

export function isOutdatedHelperError(error: string): boolean {
    if (!error) {
        return false;
    }
    return /command not found|unknown command|no such command|not implemented/i.test(error);
}

export function summarizeGpus(gpus: GpuData[]): string {
    if (gpus == null || gpus.length === 0) {
        return "";
    }
    const names = new Map<string, number>();
    for (const gpu of gpus) {
        names.set(gpu.name, (names.get(gpu.name) ?? 0) + 1);
    }
    return [...names.entries()].map(([name, count]) => (count > 1 ? `${count} × ${name}` : name)).join(", ");
}

export function pushHistory(history: number[], value: number, maxLen = HostHistoryLength): number[] {
    const next = history.length >= maxLen ? history.slice(history.length - maxLen + 1) : history.slice();
    next.push(isValidNumber(value) ? value : NaN);
    return next;
}
