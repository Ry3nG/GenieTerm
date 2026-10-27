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

    it("does not publish a completed forward into a different host after switching", async () => {
        const model = Object.create(HostViewModel.prototype) as HostViewModel;
        model.connection = atom("first-host");
        model.forwardsAtom = atom<PortForwardInfo[]>([]);
        model.forwardActionAtom = atom(null) as HostViewModel["forwardActionAtom"];
        model.openLocalPort = vi.fn();
        let complete: (value: PortForwardInfo) => void;
        model.env = {
            rpc: {
                PortForwardStartCommand: () =>
                    new Promise((resolve) => {
                        complete = resolve;
                    }),
            },
        } as unknown as HostViewModel["env"];
        const pending = model.startForward(3000);
        globalStore.set(model.connection as ReturnType<typeof atom<string>>, "second-host");
        complete({
            id: "f1",
            connname: "first-host",
            remotehost: "127.0.0.1",
            remoteport: 3000,
            localport: 3000,
            status: "waiting",
            activeconns: 0,
            createdts: 0,
        });
        await pending;
        expect(globalStore.get(model.forwardsAtom)).toEqual([]);
        expect(model.openLocalPort).not.toHaveBeenCalled();
    });
});

describe("saved service persistence", () => {
    function serviceModel(save: ReturnType<typeof vi.fn>) {
        const service: SavedPortService = {
            id: "api",
            name: "API",
            remotehost: "127.0.0.1",
            remoteport: 3000,
            localport: 0,
            restore: false,
        };
        const model = Object.create(HostViewModel.prototype) as HostViewModel;
        model.connection = atom("dev");
        model.savedServicesAtom = atom([service]);
        model.servicesPendingAtom = atom(null) as HostViewModel["servicesPendingAtom"];
        model.serviceDraftAtom = atom(service);
        model.serviceActionAtom = atom({ busy: false, error: "" });
        const config = atom([service]);
        model.env = {
            rpc: { UpdateSavedPortServiceCommand: save },
            getConnConfigKeyAtom: () => config,
        } as unknown as HostViewModel["env"];
        return { model, service };
    }

    it("mutates only one saved service and shows the committed list from other windows", async () => {
        const save = vi.fn();
        const { model, service } = serviceModel(save);
        const updated = { ...service, name: "Development API", restore: true };
        const otherWindowService = { ...service, id: "other", remoteport: 4000 };
        save.mockResolvedValue([updated, otherWindowService]);
        expect(await model.saveService(updated)).toBe(true);
        expect(save).toHaveBeenCalledWith(expect.anything(), {
            host: "dev",
            service: updated,
            remove: false,
        });
        expect(globalStore.get(model.servicesPendingAtom).services).toEqual([updated, otherWindowService]);
        expect(globalStore.get(model.serviceDraftAtom)).toBeNull();
    });

    it("forgets one service without submitting a stale replacement list", async () => {
        const save = vi.fn().mockResolvedValue([]);
        const { model, service } = serviceModel(save);
        expect(await model.saveService(service, true)).toBe(true);
        expect(save).toHaveBeenCalledWith(expect.anything(), { host: "dev", service, remove: true });
        expect(globalStore.get(model.servicesPendingAtom).services).toEqual([]);
    });

    it("retains the editor and existing definition when saving fails", async () => {
        const save = vi.fn().mockRejectedValue(new Error("Disk is read-only"));
        const { model, service } = serviceModel(save);
        expect(await model.saveService({ ...service, restore: true })).toBe(false);
        expect(globalStore.get(model.servicesPendingAtom)).toBeNull();
        expect(globalStore.get(model.serviceDraftAtom)).toEqual(service);
        expect(globalStore.get(model.serviceActionAtom)).toEqual({ busy: false, error: "Disk is read-only" });
    });
});
