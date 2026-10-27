// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { makeORef } from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { ProcessViewerViewModel } from "@/app/view/processviewer/processviewer";
import type { ConnConfigKeyAtomFnType, MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { fireAndForget, isBlank, makeConnRoute } from "@/util/util";
import * as jotai from "jotai";
import { HostView } from "./host";
import { HostSession, makeHostSessions } from "./host-sessions-util";
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
        RemoteProcessListCommand: WaveEnv["rpc"]["RemoteProcessListCommand"];
        PortForwardStartCommand: WaveEnv["rpc"]["PortForwardStartCommand"];
        PortForwardStopCommand: WaveEnv["rpc"]["PortForwardStopCommand"];
        PortForwardListCommand: WaveEnv["rpc"]["PortForwardListCommand"];
        JobControllerListCommand: WaveEnv["rpc"]["JobControllerListCommand"];
        JobControllerConnectedJobsCommand: WaveEnv["rpc"]["JobControllerConnectedJobsCommand"];
        JobControllerReconnectJobCommand: WaveEnv["rpc"]["JobControllerReconnectJobCommand"];
        ConnEnsureCommand: WaveEnv["rpc"]["ConnEnsureCommand"];
        BlockInfoCommand: WaveEnv["rpc"]["BlockInfoCommand"];
        WaitForRouteCommand: WaveEnv["rpc"]["WaitForRouteCommand"];
        SetBlockFocusCommand: WaveEnv["rpc"]["SetBlockFocusCommand"];
        ConnReinstallWshCommand: WaveEnv["rpc"]["ConnReinstallWshCommand"];
        SetConnectionsConfigCommand: WaveEnv["rpc"]["SetConnectionsConfigCommand"];
        UpdateSavedPortServiceCommand: WaveEnv["rpc"]["UpdateSavedPortServiceCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
    };
    electron: {
        openExternal: WaveEnv["electron"]["openExternal"];
        switchWorkspace: WaveEnv["electron"]["switchWorkspace"];
        setActiveTab: WaveEnv["electron"]["setActiveTab"];
    };
    services: { workspace: WaveEnv["services"]["workspace"] };
    atoms: { workspaceId: WaveEnv["atoms"]["workspaceId"] };
    getConnConfigKeyAtom: ConnConfigKeyAtomFnType<"conn:services">;
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
    gpuMem: Map<number, number[]>;
};

// "summary" or one resource: cpu, memory, network, disks, gpu:<index>
export type HostResource = string;

export type TopProcessesState = { sortBy: "cpu" | "mem"; data: ProcessListResponse; error: string };

export type PortsState = {
    data: ListeningPortsResponse;
    error: string;
    outdated: boolean;
    loading: boolean;
    updatedTs: number;
};

export type ForwardAction = { port: number; remoteHost: string; error: string; busy: boolean };

export type HelperUpdateState = { busy: boolean; error: string };

function emptyPortsState(): PortsState {
    return { data: null, error: "", outdated: false, loading: false, updatedTs: 0 };
}

// must stay well under the helper's 15 s watcher expiry
const SysInfoWatchRenewMs = 5000;
const PortsPollMs = 3000;
const SampleGapMs = 2500;

function emptySamples(): HostSamples {
    return { ts: [], cpu: [], mem: [], netDown: [], netUp: [], gpuUtil: new Map(), gpuMem: new Map() };
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
    const gpuMem = new Map<number, number[]>();
    for (const gpu of data.gpus ?? []) {
        gpuUtil.set(gpu.index, pushHistory(base.gpuUtil.get(gpu.index) ?? [], gpu.util));
        const memPct = gpu.memtotal > 0 && gpu.memused >= 0 ? (gpu.memused / gpu.memtotal) * 100 : NaN;
        gpuMem.set(gpu.index, pushHistory(base.gpuMem.get(gpu.index) ?? [], memPct));
    }
    return {
        ts: pushHistory(base.ts, data.ts),
        cpu: pushHistory(base.cpu, values["cpu"]),
        mem: pushHistory(base.mem, values["mem:total"] > 0 ? (values["mem:used"] / values["mem:total"]) * 100 : NaN),
        netDown: pushHistory(base.netDown, values["net:down"]),
        netUp: pushHistory(base.netUp, values["net:up"]),
        gpuUtil,
        gpuMem,
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
    portsAtom = jotai.atom<PortsState>(emptyPortsState()) as jotai.PrimitiveAtom<PortsState>;
    // "this host's genie helper predates the Host view" (it answers sysinfo but not host info or ports)
    helperOutdatedAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    helperUpdateAtom = jotai.atom<HelperUpdateState>({
        busy: false,
        error: "",
    }) as jotai.PrimitiveAtom<HelperUpdateState>;
    forwardsAtom = jotai.atom<PortForwardInfo[]>([]) as jotai.PrimitiveAtom<PortForwardInfo[]>;
    forwardActionAtom = jotai.atom(null) as jotai.PrimitiveAtom<ForwardAction>;
    processModelAtom = jotai.atom(null) as jotai.PrimitiveAtom<ProcessViewerViewModel>;
    resourceAtom = jotai.atom<HostResource>("summary") as jotai.PrimitiveAtom<HostResource>;
    topProcessesAtom = jotai.atom<TopProcessesState>(null) as jotai.PrimitiveAtom<TopProcessesState>;
    sessionsAtom = jotai.atom<HostSession[]>([]);
    sessionsStateAtom = jotai.atom({ loading: false, error: "", updated: 0, busy: "" });
    serviceDraftAtom = jotai.atom(null) as jotai.PrimitiveAtom<SavedPortService>;
    serviceActionAtom = jotai.atom({ busy: false, error: "" });
    servicesPendingAtom = jotai.atom(null) as jotai.PrimitiveAtom<{
        conn: string;
        base: SavedPortService[];
        services: SavedPortService[];
    }>;

    connection: jotai.Atom<string>;
    connStatus: jotai.Atom<ConnStatus>;
    tabAtom: jotai.Atom<HostTab>;
    canForwardAtom: jotai.Atom<boolean>;
    savedServicesAtom: jotai.Atom<SavedPortService[]>;

    disposed = false;
    unsubs: Array<() => void> = [];
    sampling = { conn: "", active: false, renewTimer: null as ReturnType<typeof setInterval>, unsub: null };
    portsPoll = { conn: "", dataConn: "", timer: null as ReturnType<typeof setTimeout>, epoch: 0 };
    forwardsSub = { conn: "", unsub: null as () => void, epoch: 0 };
    hostInfoConn = "";
    topPoll = { key: "", timer: null as ReturnType<typeof setTimeout>, epoch: 0 };
    sessionsSub = { key: "", conn: "", epoch: 0, unsubs: [] as Array<() => void> };
    sessionsRefresh: Promise<void> = null;
    sessionsRefreshAgain = false;

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
        this.savedServicesAtom = jotai.atom((get) => {
            const conn = get(this.connection);
            const configured = get(this.env.getConnConfigKeyAtom(conn, "conn:services"));
            const pending = get(this.servicesPendingAtom);
            return pending?.conn === conn && pending.base === configured ? pending.services : (configured ?? []);
        });

        const sync = () => this.syncAll();
        this.unsubs.push(globalStore.sub(this.connection, sync));
        this.unsubs.push(globalStore.sub(this.connStatus, sync));
        this.unsubs.push(globalStore.sub(this.tabAtom, sync));
        this.unsubs.push(globalStore.sub(this.resourceAtom, sync));
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
        this.syncSessions(
            this.isVisible() && tab === "sessions" && canForwardPorts(conn) ? `${conn}|${this.isConnected()}` : ""
        );
        const resource = globalStore.get(this.resourceAtom);
        const topSort = resource === "cpu" ? "cpu" : resource === "memory" ? "mem" : "";
        this.syncTopProcesses(live && tab === "overview" && topSort ? `${conn}|${topSort}` : "");
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

    syncSessions(key: string) {
        const s = this.sessionsSub;
        if (s.key === key) {
            return;
        }
        s.unsubs.forEach((unsub) => unsub());
        s.unsubs = [];
        s.key = key;
        s.epoch++;
        if (!key) {
            return;
        }
        const conn = globalStore.get(this.connection);
        if (s.conn !== conn) {
            globalStore.set(this.sessionsAtom, []);
            globalStore.set(this.sessionsStateAtom, { loading: false, error: "", updated: 0, busy: "" });
        }
        s.conn = conn;
        const refresh = () => fireAndForget(() => this.refreshSessions());
        s.unsubs.push(waveEventSubscribeSingle({ eventType: "block:jobstatus", handler: refresh }));
        s.unsubs.push(
            waveEventSubscribeSingle({
                eventType: "waveobj:update",
                handler: (event) => {
                    if (event.data?.otype === "job") {
                        refresh();
                    }
                },
            })
        );
        refresh();
    }

    async refreshSessions() {
        if (!this.sessionsSub.key || this.disposed) {
            return;
        }
        if (this.sessionsRefresh) {
            this.sessionsRefreshAgain = true;
            return this.sessionsRefresh;
        }
        const { conn, epoch } = this.sessionsSub;
        globalStore.set(this.sessionsStateAtom, (prev) => ({ ...prev, loading: true, error: "" }));
        this.sessionsRefresh = (async () => {
            try {
                const [jobs, connected] = await Promise.all([
                    this.env.rpc.JobControllerListCommand(TabRpcClient),
                    this.env.rpc.JobControllerConnectedJobsCommand(TabRpcClient),
                ]);
                if (this.sessionsSub.epoch !== epoch || this.disposed) {
                    return;
                }
                globalStore.set(this.sessionsAtom, makeHostSessions(jobs ?? [], conn, connected ?? []));
                globalStore.set(this.sessionsStateAtom, (prev) => ({ ...prev, loading: false, updated: Date.now() }));
            } catch (e) {
                if (this.sessionsSub.epoch === epoch && !this.disposed) {
                    globalStore.set(this.sessionsStateAtom, (prev) => ({
                        ...prev,
                        loading: false,
                        error: errorText(e),
                    }));
                }
            }
        })();
        await this.sessionsRefresh;
        this.sessionsRefresh = null;
        if (this.sessionsRefreshAgain) {
            this.sessionsRefreshAgain = false;
            await this.refreshSessions();
        }
    }

    async openSession(session: HostSession, reconnect = false) {
        globalStore.set(this.sessionsStateAtom, (prev) => ({ ...prev, busy: session.id, error: "" }));
        try {
            if (reconnect) {
                await this.env.rpc.ConnEnsureCommand(TabRpcClient, { connname: globalStore.get(this.connection) });
                await this.env.rpc.JobControllerReconnectJobCommand(TabRpcClient, session.id);
                await this.refreshSessions();
            }
            if (session.blockid) {
                const info = await this.env.rpc.BlockInfoCommand(TabRpcClient, session.blockid);
                await this.env.services.workspace.SetActiveTab(info.workspaceid, info.tabid);
                if (globalStore.get(this.env.atoms.workspaceId) !== info.workspaceid) {
                    this.env.electron.switchWorkspace(info.workspaceid);
                } else {
                    this.env.electron.setActiveTab(info.tabid);
                }
                const route = `tab:${info.tabid}`;
                const ready = await this.env.rpc.WaitForRouteCommand(TabRpcClient, { routeid: route, waitms: 5000 });
                if (ready) {
                    await this.env.rpc.SetBlockFocusCommand(TabRpcClient, session.blockid, { route });
                }
            }
        } catch (e) {
            globalStore.set(this.sessionsStateAtom, (prev) => ({ ...prev, error: errorText(e) }));
        } finally {
            globalStore.set(this.sessionsStateAtom, (prev) => ({ ...prev, busy: "" }));
        }
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

    // The CPU and Memory detail views list the busiest processes; poll only while one is open.
    syncTopProcesses(key: string) {
        const t = this.topPoll;
        if (t.key === key) {
            return;
        }
        const prevConn = t.key.split("|")[0];
        clearTimeout(t.timer);
        t.timer = null;
        t.epoch++;
        t.key = key;
        if (prevConn !== "") {
            Promise.resolve(
                this.env.rpc.RemoteProcessListCommand(
                    TabRpcClient,
                    { widgetid: `${this.blockId}:top`, release: true },
                    { route: makeConnRoute(prevConn) }
                )
            ).catch(() => {});
        }
        if (key === "") {
            globalStore.set(this.topProcessesAtom, null);
            return;
        }
        const [conn, sortBy] = key.split("|") as [string, "cpu" | "mem"];
        const epoch = t.epoch;
        const tick = async () => {
            try {
                const data = await this.env.rpc.RemoteProcessListCommand(
                    TabRpcClient,
                    { widgetid: `${this.blockId}:top`, sortby: sortBy, sortdesc: true, limit: 8, interval: 2000 },
                    { route: makeConnRoute(conn), timeout: 8000 }
                );
                if (this.topPoll.epoch !== epoch) {
                    return;
                }
                globalStore.set(this.topProcessesAtom, { sortBy, data, error: "" });
            } catch (e) {
                if (this.topPoll.epoch !== epoch) {
                    return;
                }
                globalStore.set(this.topProcessesAtom, { sortBy, data: null, error: errorText(e) });
            }
            this.topPoll.timer = setTimeout(() => fireAndForget(tick), 2000);
        };
        fireAndForget(tick);
    }

    selectResource(resource: HostResource) {
        globalStore.set(this.resourceAtom, resource);
    }

    ensureHostInfo(conn: string) {
        if (this.hostInfoConn === conn) {
            return;
        }
        this.hostInfoConn = conn;
        globalStore.set(this.hostInfoAtom, null);
        globalStore.set(this.hostInfoErrorAtom, "");
        globalStore.set(this.helperOutdatedAtom, false);
        globalStore.set(this.helperUpdateAtom, { busy: false, error: "" });
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
                    const error = errorText(e);
                    globalStore.set(this.hostInfoErrorAtom, error);
                    if (isOutdatedHelperError(error)) {
                        globalStore.set(this.helperOutdatedAtom, true);
                    }
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
        // Coming back to the same host keeps the last list on screen; another host must not show it.
        if (p.dataConn !== conn) {
            p.dataConn = conn;
            globalStore.set(this.portsAtom, { ...emptyPortsState(), loading: true });
            globalStore.set(this.forwardActionAtom, null);
        } else {
            globalStore.set(this.portsAtom, (prev) => ({ ...prev, loading: prev.data == null }));
        }
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
            const outdated = isOutdatedHelperError(error);
            if (outdated) {
                globalStore.set(this.helperOutdatedAtom, true);
            }
            globalStore.set(this.portsAtom, (prev) => ({
                ...prev,
                error,
                outdated,
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
        globalStore.set(this.serviceDraftAtom, null);
        globalStore.set(this.serviceActionAtom, { busy: false, error: "" });
        globalStore.set(this.forwardActionAtom, null);
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

    async startForward(remotePort: number, localPort = 0, openAfter = true, remoteHost = "127.0.0.1") {
        const conn = globalStore.get(this.connection);
        globalStore.set(this.forwardActionAtom, { port: remotePort, remoteHost, error: "", busy: true });
        try {
            const forward = await this.env.rpc.PortForwardStartCommand(TabRpcClient, {
                connname: conn,
                remoteport: remotePort,
                remotehost: remoteHost,
                localport: localPort,
            });
            if (this.disposed || globalStore.get(this.connection) !== conn) {
                return forward;
            }
            globalStore.set(this.forwardsAtom, (prev) => [
                ...prev.filter(
                    (f) =>
                        f.id !== forward.id &&
                        !(f.remotehost === forward.remotehost && f.remoteport === forward.remoteport)
                ),
                forward,
            ]);
            globalStore.set(this.forwardActionAtom, null);
            if (openAfter) {
                this.openLocalPort(forward.localport);
            }
            return forward;
        } catch (e) {
            if (!this.disposed && globalStore.get(this.connection) === conn) {
                globalStore.set(this.forwardActionAtom, {
                    port: remotePort,
                    remoteHost,
                    error: errorText(e),
                    busy: false,
                });
            }
            return null;
        }
    }

    editService(forward?: PortForwardInfo) {
        const existing =
            forward &&
            globalStore
                .get(this.savedServicesAtom)
                .find(
                    (service) => service.remoteport === forward.remoteport && service.remotehost === forward.remotehost
                );
        globalStore.set(
            this.serviceDraftAtom,
            existing ?? {
                id: crypto.randomUUID(),
                name: forward ? `Service ${forward.remoteport}` : "",
                remotehost: forward?.remotehost ?? "127.0.0.1",
                remoteport: forward?.remoteport ?? 0,
                localport: forward?.localport ?? 0,
                restore: false,
            }
        );
        globalStore.set(this.serviceActionAtom, { busy: false, error: "" });
    }

    async saveService(service: SavedPortService, remove = false): Promise<boolean> {
        if (globalStore.get(this.serviceActionAtom).busy) {
            return false;
        }
        const conn = globalStore.get(this.connection);
        const base = globalStore.get(this.env.getConnConfigKeyAtom(conn, "conn:services"));
        globalStore.set(this.serviceActionAtom, { busy: true, error: "" });
        try {
            const services = await this.env.rpc.UpdateSavedPortServiceCommand(TabRpcClient, {
                host: conn,
                service,
                remove,
            });
            globalStore.set(this.servicesPendingAtom, { conn, base, services });
            if (globalStore.get(this.connection) === conn) {
                globalStore.set(this.serviceDraftAtom, null);
            }
            return true;
        } catch (e) {
            if (globalStore.get(this.connection) === conn) {
                globalStore.set(this.serviceActionAtom, { busy: false, error: errorText(e) });
            }
            return false;
        } finally {
            if (globalStore.get(this.connection) === conn) {
                globalStore.set(this.serviceActionAtom, (prev) => ({ ...prev, busy: false }));
            }
        }
    }

    async stopForward(forward: PortForwardInfo) {
        try {
            await this.env.rpc.PortForwardStopCommand(TabRpcClient, { id: forward.id });
            globalStore.set(this.forwardsAtom, (prev) => prev.filter((f) => f.id !== forward.id));
        } catch (e) {
            globalStore.set(this.forwardActionAtom, {
                port: forward.remoteport,
                remoteHost: forward.remotehost,
                error: errorText(e),
                busy: false,
            });
        }
    }

    // Installs the current genie helper and restarts it on the live SSH connection; shells stay up.
    async updateHelper(turnOn = false) {
        const conn = globalStore.get(this.connection);
        globalStore.set(this.helperUpdateAtom, { busy: true, error: "" });
        try {
            if (turnOn) {
                const metamaptype: unknown = { "conn:wshenabled": true };
                await this.env.rpc.SetConnectionsConfigCommand(TabRpcClient, { host: conn, metamaptype });
            }
            await this.env.rpc.ConnReinstallWshCommand(TabRpcClient, { connname: conn }, { timeout: 120000 });
        } catch (e) {
            globalStore.set(this.helperUpdateAtom, { busy: false, error: errorText(e) });
            return;
        }
        globalStore.set(this.helperUpdateAtom, { busy: false, error: "" });
        globalStore.set(this.helperOutdatedAtom, false);
        this.hostInfoConn = "";
        this.portsPoll.conn = "";
        this.portsPoll.dataConn = "";
        this.stopSampling();
        this.syncAll();
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
            ["sessions", "Sessions"],
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
        this.syncTopProcesses("");
        this.syncForwards("");
        this.syncSessions("");
        for (const unsub of this.unsubs) {
            unsub();
        }
        this.unsubs = [];
        globalStore.get(this.processModelAtom)?.dispose();
    }
}
