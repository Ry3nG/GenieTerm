// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabClient } from "@/app/store/tabrpcclient";
import { setWpsRpcClient, wpsReconnectHandler } from "@/app/store/wps";
import { makeTabRouteId, WshRouter } from "@/app/store/wshrouter";
import { getWSServerEndpoint } from "@/util/endpoints";
import { diffTabRoutes } from "./tabpaneutils";
import { addWSReconnectHandler, globalWS, initGlobalWS, WSControl } from "./ws";
import { DefaultRouter, setDefaultRouter } from "./wshrpcutil-base";

let TabRpcClient: TabClient;
const TabRoutes = new Set<string>();

export function syncTabRoutes(tabIds: string[]) {
    const { added, removed } = diffTabRoutes(TabRoutes, tabIds);
    for (const id of removed) {
        DefaultRouter.unregisterRoute(makeTabRouteId(id));
        TabRoutes.delete(id);
    }
    for (const id of added) {
        const route = makeTabRouteId(id);
        DefaultRouter.registerRoute(route, new TabClient(route, id));
        TabRoutes.add(id);
    }
}

function initWshrpc(routeId: string): WSControl {
    const router = new WshRouter(new UpstreamWshRpcProxy());
    setDefaultRouter(router);
    const handleFn = (event: WSEventType) => {
        DefaultRouter.recvRpcMessage(event.data);
    };
    initGlobalWS(getWSServerEndpoint(), routeId, handleFn);
    globalWS.connectNow("connectWshrpc");
    TabRpcClient = new TabClient(routeId);
    setWpsRpcClient(TabRpcClient);
    DefaultRouter.registerRoute(TabRpcClient.routeId, TabRpcClient);
    addWSReconnectHandler(() => {
        DefaultRouter.reannounceRoutes();
    });
    addWSReconnectHandler(wpsReconnectHandler);
    return globalWS;
}

class UpstreamWshRpcProxy implements AbstractWshClient {
    recvRpcMessage(msg: RpcMessage): void {
        const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
        globalWS?.pushMessage(wsMsg);
    }
}

export { initElectronWshrpc, sendRpcCommand, sendRpcResponse, shutdownWshrpc } from "./wshrpcutil-base";
export { DefaultRouter, initWshrpc, TabRpcClient };
