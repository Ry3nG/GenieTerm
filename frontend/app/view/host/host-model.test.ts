// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";

vi.mock("./host", () => ({ HostView: () => null }));
vi.mock("@/app/view/processviewer/processviewer", () => ({ ProcessViewerViewModel: class {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/util/fetchutil", () => ({ fetch: vi.fn() }));

import { globalStore } from "@/app/store/jotaiStore";
import { HostViewModel } from "./host-model";
import { makePortRows } from "./hostutil";

describe("Host port forwarding", () => {
    it("sends the selected listener address to the server and opens the assigned local port", async () => {
        const model = Object.create(HostViewModel.prototype) as HostViewModel;
        model.connection = atom("paw-5090");
        model.forwardsAtom = atom<PortForwardInfo[]>([]);
        model.forwardActionAtom = atom(null) as HostViewModel["forwardActionAtom"];
        model.openLocalPort = vi.fn();
        const start = vi.fn(async (_client, data: CommandPortForwardStartData) => ({
            ...data,
            id: "forward-1",
            localport: 49123,
            status: "waiting",
            activeconns: 0,
            createdts: 0,
        }));
        model.env = { rpc: { PortForwardStartCommand: start } } as unknown as HostViewModel["env"];
        const [row] = makePortRows([{ port: 8795, address: "100.116.159.18", pid: 3095390 }], []);

        await model.startForward(row.port, 0, true, row.remoteHost);

        expect(start).toHaveBeenCalledWith(expect.anything(), {
            connname: "paw-5090",
            remotehost: "100.116.159.18",
            remoteport: 8795,
            localport: 0,
        });
        expect(model.openLocalPort).toHaveBeenCalledWith(49123);
        expect(globalStore.get(model.forwardsAtom)[0].remotehost).toBe("100.116.159.18");
        expect(globalStore.get(model.forwardActionAtom)).toBeNull();
    });
});
