// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/view/term/term", () => ({ TermClaudeIcon: () => null, TerminalView: () => null }));
vi.mock("@/app/view/vdom/vdom-model", () => ({ VDomModel: class {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import * as jotai from "jotai";
import { TermViewModel } from "./term-model";

function makeModel() {
    const model = Object.create(TermViewModel.prototype) as TermViewModel;
    model.blockId = "terminal-1";
    model.connStatus = jotai.atom({ connection: "root@host", status: "connected", wshenabled: true } as ConnStatus);
    model.restartSessionWithDurability = vi.fn().mockResolvedValue(undefined);
    model.forceRestartController = vi.fn().mockResolvedValue(undefined);
    return model;
}

afterEach(() => vi.restoreAllMocks());

describe("terminal block status actions", () => {
    it.each(["keep-running", "not-now"] as const)("persists the durable prompt for %s", async (action) => {
        const model = makeModel();
        const setMeta = vi.spyOn(RpcApi, "SetMetaCommand").mockResolvedValue(undefined);
        await model.handleBlockStatusAction(action);
        expect(setMeta.mock.calls[0][1]).toEqual({ oref: "block:terminal-1", meta: { "term:durableprompted": true } });
        if (action == "keep-running") {
            expect(model.restartSessionWithDurability).toHaveBeenCalledWith(true);
            return;
        }
        expect(model.restartSessionWithDurability).not.toHaveBeenCalled();
    });

    it("surfaces failed durable activation after persistence so the line can offer Retry", async () => {
        const model = makeModel();
        vi.spyOn(RpcApi, "SetMetaCommand").mockResolvedValue(undefined);
        vi.mocked(model.restartSessionWithDurability).mockRejectedValue(new Error("helper unavailable"));
        await expect(model.handleBlockStatusAction("keep-running")).rejects.toThrow("helper unavailable");
    });

    it("enables the helper before reconnecting and restarting the shell", async () => {
        const model = makeModel();
        const calls: string[] = [];
        const config = vi.spyOn(RpcApi, "SetConnectionsConfigCommand").mockImplementation(async () => {
            calls.push("config");
        });
        vi.spyOn(RpcApi, "ConnDisconnectCommand").mockImplementation(async () => {
            calls.push("disconnect");
        });
        const connect = vi.spyOn(RpcApi, "ConnConnectCommand").mockImplementation(async () => {
            calls.push("connect");
        });
        vi.mocked(model.forceRestartController).mockImplementation(async () => {
            calls.push("restart");
        });
        await model.handleBlockStatusAction("enable");
        expect(calls).toEqual(["config", "disconnect", "connect", "restart"]);
        expect(config.mock.calls[0][1]).toEqual({ host: "root@host", metamaptype: { "conn:wshenabled": true } });
        expect(connect.mock.calls[0].slice(1)).toEqual([
            { host: "root@host", logblockid: "terminal-1" },
            { timeout: 120000 },
        ]);
    });

    it("does not restart a shell after the block switches connections during recovery", async () => {
        const model = makeModel();
        vi.spyOn(RpcApi, "ConnDisconnectCommand").mockResolvedValue(undefined);
        vi.spyOn(RpcApi, "ConnConnectCommand").mockImplementation(async () => {
            globalStore.set(
                model.connStatus as jotai.PrimitiveAtom<ConnStatus>,
                { connection: "other@host", status: "connected", wshenabled: true } as ConnStatus
            );
        });
        await model.handleBlockStatusAction("recover-connection");
        expect(model.forceRestartController).not.toHaveBeenCalled();
    });
});
