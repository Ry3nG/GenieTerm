// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getNotifyAfterOption, NotifyAfterOptions } from "./notifyafter";

describe("notification threshold options", () => {
    it("maps labels to seconds", () => {
        expect(NotifyAfterOptions.map(({ label, value }) => [label, Number(value)])).toEqual([
            ["Off", 0],
            ["10 s", 10],
            ["30 s", 30],
            ["1 min", 60],
            ["5 min", 300],
        ]);
    });

    it.each([
        [0, "0"],
        [10, "10"],
        [30, "30"],
        [60, "60"],
        [300, "300"],
        [12, "10"],
        [29.9, "30"],
        [45, "30"],
        [46, "60"],
        [180, "60"],
        [181, "300"],
        [-100, "0"],
        [1000, "300"],
        [null, "10"],
        [undefined, "10"],
        [NaN, "10"],
        [Infinity, "10"],
        ["30", "10"],
    ])("displays %s as %s", (value, expected) => {
        expect(getNotifyAfterOption(value)).toBe(expected);
    });
});
