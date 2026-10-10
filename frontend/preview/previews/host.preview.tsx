// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block } from "@/app/block/block";
import { globalStore } from "@/app/store/jotaiStore";
import { handleWaveEvent } from "@/app/store/wps";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import * as React from "react";
import { makeMockNodeModel } from "../mock/mock-node-model";
import { HostPortsBlockId, SysinfoBlockId } from "../mock/mockwaveenv";
import { useRpcOverride } from "../mock/use-rpc-override";
import {
    DefaultSysinfoHistoryPoints,
    makeMockForwards,
    makeMockProcessList,
    makeMockSysinfoEvent,
    makeMockSysinfoHistory,
    MockHostInfo,
    MockListeningPorts,
    MockSshConnection,
} from "./host.preview-util";

function HostBlock({ blockId, nodeId, height }: { blockId: string; nodeId: string; height: number }) {
    const nodeModel = React.useMemo(
        () =>
            makeMockNodeModel({
                nodeId,
                blockId,
                innerRect: { width: "100%", height: `${height}px` },
                numLeafs: 2,
            }),
        [blockId, nodeId, height]
    );
    return (
        <div className="rounded-md border border-border bg-panel p-4">
            <div style={{ height }}>
                <Block preview={false} nodeModel={nodeModel} />
            </div>
        </div>
    );
}

export default function HostPreview() {
    const env = useWaveEnv();
    const historyRef = React.useRef(makeMockSysinfoHistory(DefaultSysinfoHistoryPoints, Date.now(), MockSshConnection));
    const forwardsRef = React.useRef(makeMockForwards());

    React.useState(() => {
        globalStore.set(env.getConnStatusAtom(MockSshConnection), {
            status: "connected",
            connection: MockSshConnection,
            connected: true,
            hasconnected: true,
            activeconnnum: 1,
            wshenabled: true,
        } as ConnStatus);
        return null;
    });

    useRpcOverride("RemoteSysInfoWatchCommand", async () => undefined);
    useRpcOverride("RemoteProcessListCommand", async (_client, data: CommandRemoteProcessListData) =>
        data?.keepalive || data?.release ? null : makeMockProcessList(data)
    );
    useRpcOverride("RemoteHostInfoCommand", async () => MockHostInfo);
    useRpcOverride("RemoteListeningPortsCommand", async () => MockListeningPorts);
    useRpcOverride("PortForwardListCommand", async () => forwardsRef.current);
    useRpcOverride("PortForwardStartCommand", async (_client, data: CommandPortForwardStartData) => {
        const forward: PortForwardInfo = {
            id: `fwd-${data.remoteport}`,
            connname: data.connname,
            remotehost: "127.0.0.1",
            remoteport: data.remoteport,
            localport: data.localport || data.remoteport,
            status: "active",
            activeconns: 0,
            createdts: Date.now(),
        };
        forwardsRef.current = [...forwardsRef.current.filter((f) => f.id !== forward.id), forward];
        return forward;
    });
    useRpcOverride("PortForwardStopCommand", async (_client, data: CommandPortForwardStopData) => {
        forwardsRef.current = forwardsRef.current.filter((f) => f.id !== data.id);
    });
    useRpcOverride("EventReadHistoryCommand", async (_client, data) => {
        if (data.event !== "sysinfo" || data.scope !== MockSshConnection) {
            return [];
        }
        const maxItems = data.maxitems ?? historyRef.current.length;
        return historyRef.current.slice(-maxItems);
    });

    React.useEffect(() => {
        let nextStep = historyRef.current.length;
        let nextTs = (historyRef.current[historyRef.current.length - 1]?.data?.ts ?? Date.now()) + 1000;
        const intervalId = window.setInterval(() => {
            const nextEvent = makeMockSysinfoEvent(nextTs, nextStep, MockSshConnection);
            historyRef.current = [...historyRef.current.slice(-(DefaultSysinfoHistoryPoints - 1)), nextEvent];
            handleWaveEvent(nextEvent);
            nextStep++;
            nextTs += 1000;
        }, 1000);
        return () => window.clearInterval(intervalId);
    }, []);

    return (
        <div className="flex w-full max-w-[1240px] flex-col gap-4 px-6 py-6">
            <div className="font-mono text-xs text-muted">host block: overview (mock SSH host with 8 GPUs)</div>
            <HostBlock blockId={SysinfoBlockId} nodeId="preview-host-overview" height={1180} />
            <div className="font-mono text-xs text-muted">host block: ports</div>
            <HostBlock blockId={HostPortsBlockId} nodeId="preview-host-ports" height={520} />
        </div>
    );
}
