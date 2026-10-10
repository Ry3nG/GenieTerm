// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { makeORef } from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { ProcessViewerViewModel } from "@/app/view/processviewer/processviewer";
import type { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { fireAndForget, isBlank, makeConnRoute } from "@/util/util";
import * as jotai from "jotai";
import { HostView } from "./host";
import {
    canForwardPorts,
    HostHistoryLength,
    HostTab,
    isOutdatedHelperError,
    normalizeHostTab,
    pushHistory,
} from "./hostutil";

export type HostEnv = WaveEnvSubset<{
    rpc: {
        EventReadHistoryCommand: WaveEnv["rpc"]["EventReadHistoryCommand"];
        RemoteSysInfoWatchCommand: WaveEnv["rpc"]["RemoteSysInfoWatchCommand"];
        RemoteHostInfoCommand: WaveEnv["rpc"]["RemoteHostInfoCommand"];
        RemoteListeningPortsCommand: WaveEnv["rpc"]["RemoteListeningPortsCommand"];
        PortForwardStartCommand: WaveEnv["rpc"]["PortForwardStartCommand"];
        PortForwardStopCommand: WaveEnv["rpc"]["PortForwardStopCommand"];
        PortForwardListCommand: WaveEnv["rpc"]["PortForwardListCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
    };
    electron: {
        openExternal: WaveEnv["electron"]["openExternal"];
    };
    isMock: WaveEnv["isMock"];
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"connection" | "host:tab" | "view">;
}>;

export type HostSamples = {
    ts: number[];
    cpu: number[];
    mem: number[];
    netDown: number[];
    netUp: number[];
    gpuUtil: Map<number, number[]>;
};

export type PortsState = {
    data: ListeningPortsResponse;
    error: string;
    outdated: boolean;
    loading: boolean;
    updatedTs: number;
};

export type ForwardAction = { port: number; error: string; busy: boolean };

// must stay well under the helper's 15 s watcher expiry
const SysInfoWatchRenewMs = 5000;
const PortsPollMs = 3000;
const SampleGapMs = 2500;

function emptySamples(): HostSamples {
    return { ts: [], cpu: [], mem: [], netDown: [], netUp: [], gpuUtil: new Map() };
}

function isDocumentHidden(): boolean {
    return typeof document !== "undefined" && document.hidden;
}

function errorText(e: unknown): string {
    if (e instanceof Error) {
        return e.message;
    }
    return String(e);
}

export function appendSample(samples: HostSamples, data: TimeSeriesData): HostSamples {
    const lastTs = samples.ts[samples.ts.length - 1] ?? 0;
    const base = lastTs > 0 && data.ts - lastTs > SampleGapMs ? emptySamples() : samples;
    const values = data.values ?? {};
    const gpuUtil = new Map<number, number[]>();
    for (const gpu of data.gpus ?? []) {
        gpuUtil.set(gpu.index, pushHistory(base.gpuUtil.get(gpu.index) ?? [], gpu.util));
    }
    return {
        ts: pushHistory(base.ts, data.ts),
        cpu: pushHistory(base.cpu, values["cpu"]),
        mem: pushHistory(base.mem, values["mem:total"] > 0 ? (values["mem:used"] / values["mem:total"]) * 100 : NaN),
        netDown: pushHistory(base.netDown, values["net:down"]),
        netUp: pushHistory(base.netUp, values["net:up"]),
        gpuUtil,
    };
}

export class HostViewModel implements ViewModel {
    viewType = "host";
    blockId: string;
    env: HostEnv;
    tabModel: TabModel;
    fullEnv: WaveEnv;

    viewIcon = jotai.atom<string>("server");
    viewName = jotai.atom<string>("Host");
    manageConnection = jotai.atom<boolean>(true);
    filterOutNowsh = jotai.atom<boolean>(true);
    noPadding = jotai.atom<boolean>(true);

    latestAtom = jotai.atom(null) as jotai.PrimitiveAtom<TimeSeriesData>;
    samplesAtom = jotai.atom(emptySamples()) as jotai.PrimitiveAtom<HostSamples>;
    hostInfoAtom = jotai.atom(null) as jotai.PrimitiveAtom<HostInfo>;
    hostInfoErrorAtom = jotai.atom("") as jotai.PrimitiveAtom<string>;
    portsAtom = jotai.atom<PortsState>({
        data: null,
        error: "",
        outdated: false,
        loading: false,
        updatedTs: 0,
    }) as jotai.PrimitiveAtom<PortsState>;
    forwardsAtom = jotai.atom<PortForwardInfo[]>([]) as jotai.PrimitiveAtom<PortForwardInfo[]>;
    forwardActionAtom = jotai.atom(null) as jotai.PrimitiveAtom<ForwardAction>;
    processModelAtom = jotai.atom(null) as jotai.PrimitiveAtom<ProcessViewerViewModel>;

    connection: jotai.Atom<string>;
    connStatus: jotai.Atom<ConnStatus>;
    tabAtom: jotai.Atom<HostTab>;
    canForwardAtom: jotai.Atom<boolean>;

    disposed = false;
    unsubs: Array<() => void> = [];
    sampling = { conn: "", active: false, renewTimer: null as ReturnType<typeof setInterval>, unsub: null };
    portsPoll = { conn: "", timer: null as ReturnType<typeof setTimeout>, epoch: 0 };
    forwardsSub = { conn: "", unsub: null as () => void, epoch: 0 };
    hostInfoConn = "";

    constructor({ blockId, waveEnv, tabModel }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv;
        this.fullEnv = waveEnv;
        this.tabModel = tabModel;
        this.connection = jotai.atom((get) => {
            const conn = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            return isBlank(conn) ? "local" : conn;
        });
        this.connStatus = jotai.atom((get) => {
            const conn = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            return get(this.env.getConnStatusAtom(conn));
        });
        this.tabAtom = jotai.atom((get) => {
            const legacyView = get(this.env.getBlockMetaKeyAtom(blockId, "view"));
            const fallback: HostTab = legacyView === "processviewer" ? "processes" : "overview";
            return normalizeHostTab(get(this.env.getBlockMetaKeyAtom(blockId, "host:tab")), fallback);
        });
        this.canForwardAtom = jotai.atom((get) => canForwardPorts(get(this.connection)));

        const sync = () => this.syncAll();
        this.unsubs.push(globalStore.sub(this.connection, sync));
        this.unsubs.push(globalStore.sub(this.connStatus, sync));
        this.unsubs.push(globalStore.sub(this.tabAtom, sync));
        this.unsubs.push(globalStore.sub(tabModel.isActiveAtom, sync));
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", sync);
            this.unsubs.push(() => document.removeEventListener("visibilitychange", sync));
        }
        this.syncAll();
    }

    get viewComponent(): ViewComponent {
        return HostView;
    }

    isVisible(): boolean {
        return !this.disposed && !isDocumentHidden() && globalStore.get(this.tabModel.isActiveAtom);
    }

    isConnected(): boolean {
        return globalStore.get(this.connStatus)?.status === "connected";
    }

    syncAll() {
        if (this.disposed) {
            return;
        }
        const conn = globalStore.get(this.connection);
        const tab = globalStore.get(this.tabAtom);
        const live = this.isVisible() && this.isConnected();
        this.syncSampling(live && tab === "overview" ? conn : "");
        this.syncPortsPolling(live && tab === "ports" ? conn : "");
        this.syncForwards(canForwardPorts(conn) ? conn : "");
        if (live) {
            this.ensureHostInfo(conn);
        }
        this.syncProcessModel(tab);
    }

    async setTab(tab: HostTab) {
        await this.env.rpc.SetMetaCommand(TabRpcClient, {
            oref: makeORef("block", this.blockId),
            meta: { "host:tab": tab },
        });
    }

    getProcessModel(): ProcessViewerViewModel {
        let model = globalStore.get(this.processModelAtom);
        if (model == null) {
            model = new ProcessViewerViewModel({
                blockId: this.blockId,
                waveEnv: this.fullEnv,
                tabModel: this.tabModel,
                nodeModel: null,
            });
            globalStore.set(this.processModelAtom, model);
        }
        return model;
    }

    syncProcessModel(tab: HostTab) {
        const existing = globalStore.get(this.processModelAtom);
        if (tab === "processes") {
            const model = existing ?? this.getProcessModel();
            globalStore.set(model.suspendedAtom, false);
            return;
        }
        if (existing != null) {
            globalStore.set(existing.suspendedAtom, true);
        }
    }

    showProcess(pid: number) {
        const model = this.getProcessModel();
        globalStore.set(model.textSearchAtom, String(pid));
        globalStore.set(model.searchOpenAtom, true);
        globalStore.set(model.selectedPidAtom, pid);
        fireAndForget(() => this.setTab("processes"));
    }

    // Sampling: the helper only samples while some view holds a watch lease for this block.
    syncSampling(conn: string) {
        const s = this.sampling;
        if (s.conn === conn && s.active === (conn !== "")) {
            return;
        }
        this.stopSampling();
        if (conn === "") {
            return;
        }
        s.conn = conn;
        s.active = true;
        const route = makeConnRoute(conn);
        const sendWatch = (active: boolean) => {
            Promise.resolve(
                this.env.rpc.RemoteSysInfoWatchCommand(TabRpcClient, { watcherid: this.blockId, active }, { route })
            ).catch((e) => console.log("host: sysinfo watch failed", conn, e));
        };
        sendWatch(true);
        s.renewTimer = setInterval(() => sendWatch(true), SysInfoWatchRenewMs);
        s.unsub = waveEventSubscribeSingle({
            eventType: "sysinfo",
            scope: conn,
            handler: (event) => {
                if (this.sampling.conn !== conn || event.data == null) {
                    return;
                }
                this.addSample(event.data);
            },
        });
        fireAndForget(() => this.loadHistory(conn));
    }

    stopSampling() {
        const s = this.sampling;
        if (!s.active) {
            return;
        }
        const conn = s.conn;
        clearInterval(s.renewTimer);
        s.unsub?.();
        s.active = false;
        s.conn = "";
        s.renewTimer = null;
        s.unsub = null;
        Promise.resolve(
            this.env.rpc.RemoteSysInfoWatchCommand(
                TabRpcClient,
                { watcherid: this.blockId, active: false },
                { route: makeConnRoute(conn) }
            )
        ).catch(() => {});
    }

    addSample(data: TimeSeriesData) {
        globalStore.set(this.latestAtom, data);
        globalStore.set(this.samplesAtom, (prev) => appendSample(prev, data));
    }

    async loadHistory(conn: string) {
        try {
            const history = await this.env.rpc.EventReadHistoryCommand(TabRpcClient, {
                event: "sysinfo",
                scope: conn,
                maxitems: HostHistoryLength,
            });
            if (this.sampling.conn !== conn || history == null) {
                return;
            }
            let samples = emptySamples();
            let latest: TimeSeriesData = null;
            for (const event of history) {
                const data = event.data as TimeSeriesData;
                if (data?.ts == null) {
                    continue;
                }
                samples = appendSample(samples, data);
                latest = data;
            }
            const current = globalStore.get(this.samplesAtom);
            const currentLast = current.ts[current.ts.length - 1] ?? 0;
            if (latest != null && latest.ts >= currentLast) {
                globalStore.set(this.samplesAtom, samples);
                globalStore.set(this.latestAtom, latest);
            }
        } catch (e) {
            console.log("host: reading sysinfo history failed", conn, e);
        }
    }

    ensureHostInfo(conn: string) {
        if (this.hostInfoConn === conn) {
            return;
        }
        this.hostInfoConn = conn;
        globalStore.set(this.hostInfoAtom, null);
        globalStore.set(this.hostInfoErrorAtom, "");
        globalStore.set(this.latestAtom, null);
        globalStore.set(this.samplesAtom, emptySamples());
        fireAndForget(async () => {
            try {
                const info = await this.env.rpc.RemoteHostInfoCommand(TabRpcClient, { route: makeConnRoute(conn) });
                if (this.hostInfoConn === conn) {
                    globalStore.set(this.hostInfoAtom, info);
                }
            } catch (e) {
                if (this.hostInfoConn === conn) {
                    globalStore.set(this.hostInfoErrorAtom, errorText(e));
                }
            }
        });
    }

    syncPortsPolling(conn: string) {
        const p = this.portsPoll;
        if (p.conn === conn) {
            return;
        }
        clearTimeout(p.timer);
        p.timer = null;
        p.epoch++;
        p.conn = conn;
        if (conn === "") {
            return;
        }
        const epoch = p.epoch;
        globalStore.set(this.portsAtom, (prev) => ({ ...prev, loading: prev.data == null }));
        const tick = async () => {
            await this.fetchPorts(conn, epoch);
            if (this.portsPoll.epoch !== epoch) {
                return;
            }
            this.portsPoll.timer = setTimeout(() => fireAndForget(tick), PortsPollMs);
        };
        fireAndForget(tick);
    }

    async refreshPorts() {
        const conn = this.portsPoll.conn;
        if (conn === "") {
            return;
        }
        await this.fetchPorts(conn, this.portsPoll.epoch);
    }

    async fetchPorts(conn: string, epoch: number) {
        try {
            const data = await this.env.rpc.RemoteListeningPortsCommand(TabRpcClient, {
                route: makeConnRoute(conn),
                timeout: 8000,
            });
            if (this.portsPoll.epoch !== epoch) {
                return;
            }
            globalStore.set(this.portsAtom, {
                data,
                error: "",
                outdated: false,
                loading: false,
                updatedTs: Date.now(),
            });
        } catch (e) {
            if (this.portsPoll.epoch !== epoch) {
                return;
            }
            const error = errorText(e);
            globalStore.set(this.portsAtom, (prev) => ({
                ...prev,
                error,
                outdated: isOutdatedHelperError(error),
                loading: false,
            }));
        }
    }

    syncForwards(conn: string) {
        const f = this.forwardsSub;
        if (f.conn === conn) {
            return;
        }
        f.unsub?.();
        f.unsub = null;
        f.epoch++;
        f.conn = conn;
        globalStore.set(this.forwardsAtom, []);
        if (conn === "") {
            return;
        }
        const epoch = f.epoch;
        f.unsub = waveEventSubscribeSingle({
            eventType: "portforward",
            scope: conn,
            handler: (event) => {
                if (this.forwardsSub.epoch !== epoch) {
                    return;
                }
                globalStore.set(this.forwardsAtom, event.data ?? []);
            },
        });
        fireAndForget(async () => {
            try {
                const list = await this.env.rpc.PortForwardListCommand(TabRpcClient, { connname: conn });
                if (this.forwardsSub.epoch === epoch) {
                    globalStore.set(this.forwardsAtom, list ?? []);
                }
            } catch (e) {
                console.log("host: listing port forwards failed", conn, e);
            }
        });
    }

    async startForward(remotePort: number, localPort = 0, openAfter = true) {
        const conn = globalStore.get(this.connection);
        globalStore.set(this.forwardActionAtom, { port: remotePort, error: "", busy: true });
        try {
            const forward = await this.env.rpc.PortForwardStartCommand(TabRpcClient, {
                connname: conn,
                remoteport: remotePort,
                localport: localPort,
            });
            globalStore.set(this.forwardsAtom, (prev) => [...prev.filter((f) => f.id !== forward.id), forward]);
            globalStore.set(this.forwardActionAtom, null);
            if (openAfter) {
                this.openLocalPort(forward.localport);
            }
            return forward;
        } catch (e) {
            globalStore.set(this.forwardActionAtom, { port: remotePort, error: errorText(e), busy: false });
            return null;
        }
    }

    async stopForward(forward: PortForwardInfo) {
        globalStore.set(this.forwardsAtom, (prev) => prev.filter((f) => f.id !== forward.id));
        try {
            await this.env.rpc.PortForwardStopCommand(TabRpcClient, { id: forward.id });
        } catch (e) {
            globalStore.set(this.forwardActionAtom, {
                port: forward.remoteport,
                error: errorText(e),
                busy: false,
            });
        }
    }

    openLocalPort(port: number) {
        this.env.electron.openExternal(`http://localhost:${port}`);
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (globalStore.get(this.tabAtom) !== "processes") {
            return false;
        }
        return globalStore.get(this.processModelAtom)?.keyDownHandler(waveEvent) ?? false;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const current = globalStore.get(this.tabAtom);
        const items: Array<[HostTab, string]> = [
            ["overview", "Overview"],
            ["processes", "Processes"],
            ["ports", "Ports"],
        ];
        return [
            ...items.map(([tab, label]) => ({
                label,
                type: "radio" as const,
                checked: current === tab,
                click: () => fireAndForget(() => this.setTab(tab)),
            })),
            { type: "separator" },
        ];
    }

    dispose() {
        this.disposed = true;
        this.stopSampling();
        this.syncPortsPolling("");
        this.syncForwards("");
        for (const unsub of this.unsubs) {
            unsub();
        }
        this.unsubs = [];
        globalStore.get(this.processModelAtom)?.dispose();
    }
}
