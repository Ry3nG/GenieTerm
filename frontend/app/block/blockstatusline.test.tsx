// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockEnv } from "./blockenv";
import { getBlockStatus } from "./blockstatus";
import { BlockStatusLineContent, runBlockStatusAction } from "./blockstatusline";

function makeOptions() {
    return {
        env: {
            rpc: {
                ConnDisconnectCommand: vi.fn().mockResolvedValue(undefined),
                ConnConnectCommand: vi.fn().mockResolvedValue(undefined),
                ConnReinstallWshCommand: vi.fn().mockResolvedValue(undefined),
                SetConnectionsConfigCommand: vi.fn().mockResolvedValue(undefined),
                DismissWshFailCommand: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as BlockEnv,
        connName: "root@host",
        blockId: "block-1",
        connStatus: { status: "connected", wsherror: "Full helper failure\nincluding all details" } as ConnStatus,
        viewModel: { handleBlockStatusAction: vi.fn().mockResolvedValue(undefined) } as unknown as ViewModel,
        dismissHelperOff: vi.fn(),
    };
}

afterEach(() => vi.unstubAllGlobals());

describe("block status recovery actions", () => {
    it("closes stalled transports before connecting, with the logging block", async () => {
        const options = makeOptions();
        let finishDisconnect: () => void;
        vi.mocked(options.env.rpc.ConnDisconnectCommand).mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishDisconnect = resolve;
                })
        );
        const pending = runBlockStatusAction("reconnect-stalled", options);
        expect(options.env.rpc.ConnConnectCommand).not.toHaveBeenCalled();
        finishDisconnect();
        await pending;
        expect(options.env.rpc.ConnConnectCommand).toHaveBeenCalledWith(
            TabRpcClient,
            { host: "root@host", logblockid: "block-1" },
            { timeout: 60000 }
        );
    });

    it("does not connect when disconnect fails and propagates the error for inline retry", async () => {
        const options = makeOptions();
        vi.mocked(options.env.rpc.ConnDisconnectCommand).mockRejectedValue(new Error("disconnect failed"));
        await expect(runBlockStatusAction("reconnect-stalled", options)).rejects.toThrow("disconnect failed");
        expect(options.env.rpc.ConnConnectCommand).not.toHaveBeenCalled();
    });

    it("repairs helpers in place with a two-minute timeout", async () => {
        const options = makeOptions();
        await runBlockStatusAction("retry-helper", options);
        expect(options.env.rpc.ConnReinstallWshCommand).toHaveBeenCalledWith(
            TabRpcClient,
            { connname: "root@host", logblockid: "block-1" },
            { timeout: 120000 }
        );
        expect(options.env.rpc.ConnDisconnectCommand).not.toHaveBeenCalled();
        expect(options.env.rpc.ConnConnectCommand).not.toHaveBeenCalled();
    });

    it("cancels reconnect through disconnect", async () => {
        const options = makeOptions();
        await runBlockStatusAction("disconnect", options);
        expect(options.env.rpc.ConnDisconnectCommand).toHaveBeenCalledWith(TabRpcClient, "root@host", {
            timeout: 5000,
        });
    });

    it("preserves helper settings and the server-side failure dismissal", async () => {
        const options = makeOptions();
        await runBlockStatusAction("disable-helper", options);
        expect(options.env.rpc.SetConnectionsConfigCommand).toHaveBeenCalledWith(TabRpcClient, {
            host: "root@host",
            metamaptype: { "conn:wshenabled": false },
        });
        await runBlockStatusAction("dismiss-helper-error", options);
        expect(options.env.rpc.DismissWshFailCommand).toHaveBeenCalledWith(TabRpcClient, "root@host");
        await runBlockStatusAction("dismiss-helper-off", options);
        expect(options.dismissHelperOff).toHaveBeenCalledOnce();
    });

    it("copies full errors without truncation", async () => {
        const options = makeOptions();
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        await runBlockStatusAction("copy", options);
        expect(writeText).toHaveBeenLastCalledWith(options.connStatus.wsherror);
        options.connStatus = { ...options.connStatus, status: "error", error: "Long connection failure\n".repeat(20) };
        await runBlockStatusAction("copy", options);
        expect(writeText).toHaveBeenLastCalledWith(options.connStatus.error);
    });

    it.each(["enable", "recover-connection", "restart", "keep-running", "not-now"] as const)(
        "delegates %s to the terminal model",
        async (action) => {
            const options = makeOptions();
            await runBlockStatusAction(action, options);
            expect(options.viewModel.handleBlockStatusAction).toHaveBeenCalledWith(action);
        }
    );
});

describe("status line markup", () => {
    it("renders an accessible single status with full details and real buttons", () => {
        const status = getBlockStatus({
            connStatus: { connection: "root@host", status: "error", error: "denied <key>" } as ConnStatus,
            isTerminal: false,
            now: 0,
        });
        const markup = renderToStaticMarkup(<BlockStatusLineContent status={status} onAction={vi.fn()} />);
        expect(markup.match(/role="status"/g)).toHaveLength(1);
        expect(markup).toContain("denied &lt;key&gt;");
        expect(markup).toContain("Reconnect");
        expect(markup).toContain("Copy details");
        expect(markup).not.toContain("Dismiss status");
        expect(markup).not.toContain("absolute");
    });
});
