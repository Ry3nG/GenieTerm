// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DurableOutputGapNotice, getDurableOutputGapMessage } from "./durable-output-gap";

describe("durable output gap", () => {
    it("does not warn for legacy status or a new session", () => {
        for (const status of [null, { jobid: "legacy" }, { jobid: "new", outputgap: 0 }]) {
            expect(getDurableOutputGapMessage(status as BlockJobStatusData)).toBeNull();
            expect(renderToStaticMarkup(<DurableOutputGapNotice status={status as BlockJobStatusData} />)).toBe("");
        }
    });

    it.each(["connected", "disconnected", "done"])("preserves the warning for a %s session", (state) => {
        const status = { jobid: "session", status: state, outputgap: 4096 } as BlockJobStatusData;
        const message = getDurableOutputGapMessage(status);
        expect(message).toContain((4096).toLocaleString());
        expect(message).toContain("could not be recovered");
        const markup = renderToStaticMarkup(<DurableOutputGapNotice status={status} />);
        expect(markup).toContain('role="status"');
        expect(markup).toContain("Earlier output may be incomplete");
        expect(markup).not.toContain("session is running");
    });
});
