// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { WSControl } from "./ws";

describe("WSControl heartbeat", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("relies on the server heartbeat and only replies to server pings", () => {
        vi.useFakeTimers();
        const control = new WSControl("ws://localhost", "test", () => {});
        const send = vi.fn();
        control.wsConn = { send } as any;
        control.open = true;

        vi.advanceTimersByTime(15000);
        expect(send).not.toHaveBeenCalled();

        control.onmessage({ data: JSON.stringify({ type: "ping", stime: 1 }) } as MessageEvent);
        expect(send).toHaveBeenCalledTimes(1);
        expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ type: "pong" });
    });
});
