// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { parsePortInput } from "./hostutil";

export function makeSavedService(
    id: string,
    name: string,
    host: string,
    remote: string,
    local: string,
    restore: boolean
): SavedPortService {
    const remoteport = parsePortInput(remote);
    const localport = local.trim() ? parsePortInput(local) : 0;
    const remotehost = host.trim() || "127.0.0.1";
    if (!name.trim() || name.trim().length > 80) {
        throw new Error("Give this service a name of up to 80 characters.");
    }
    if (!remoteport || (local.trim() && !localport)) {
        throw new Error("Ports must be numbers from 1 to 65535. Leave the local port blank for automatic selection.");
    }
    if (
        remotehost.length > 253 ||
        Array.from(remotehost).some((char) => char.charCodeAt(0) <= 32 || "/[]".includes(char)) ||
        (remotehost.includes(":") && !/^[\da-f:]+(?:%[\w.-]+)?$/i.test(remotehost))
    ) {
        throw new Error("Enter a remote hostname or IP address without a port.");
    }
    return { id, name: name.trim(), remotehost, remoteport, localport, restore };
}

export function serviceForward(service: SavedPortService, forwards: PortForwardInfo[]): PortForwardInfo {
    return forwards.find(
        (forward) => forward.remotehost === service.remotehost && forward.remoteport === service.remoteport
    );
}

export function servicePortNote(service: SavedPortService, forward: PortForwardInfo): string {
    if (!forward || forward.id.startsWith("saved:")) {
        return "";
    }
    if (!service.localport && forward.localport !== service.remoteport) {
        return `Remote port ${service.remoteport} maps to local port ${forward.localport}; the preferred local port was unavailable.`;
    }
    if (service.localport && service.localport !== forward.localport) {
        return `The existing forward uses local port ${forward.localport}. Stop it before starting with ${service.localport}.`;
    }
    return "";
}
