// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getConnectionEntries, updateConnectionsJsonDisplayName } from "./connectionscontent";

describe("connections content helpers", () => {
    it("merges discovered SSH hosts with saved connection metadata", () => {
        const fullConfig: Pick<FullConfigType, "connections"> = {
            connections: {
                saved: { "display:name": "Saved host", "display:order": 2 },
            },
        };

        expect(getConnectionEntries(fullConfig, ["discovered", "saved"])).toEqual([
            { connName: "discovered", connConfig: {}, discovered: true },
            { connName: "saved", connConfig: { "display:name": "Saved host", "display:order": 2 }, discovered: false },
        ]);
    });

    it("adds a new display name without dropping other connection settings", () => {
        const nextContent = updateConnectionsJsonDisplayName(
            '{"prod":{"conn:wshenabled":false}}',
            "prod",
            "Production"
        );

        expect(JSON.parse(nextContent)).toEqual({
            prod: {
                "conn:wshenabled": false,
                "display:name": "Production",
            },
        });
    });
});
