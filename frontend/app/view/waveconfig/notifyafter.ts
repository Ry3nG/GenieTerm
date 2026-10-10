// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const NotifyAfterOptions = [
    { value: "0", label: "Off" },
    { value: "10", label: "10 s" },
    { value: "30", label: "30 s" },
    { value: "60", label: "1 min" },
    { value: "300", label: "5 min" },
];

export function getNotifyAfterOption(value: unknown): string {
    const seconds = typeof value === "number" && Number.isFinite(value) ? value : 10;
    return NotifyAfterOptions.reduce((closest, option) =>
        Math.abs(Number(option.value) - seconds) < Math.abs(Number(closest.value) - seconds) ? option : closest
    ).value;
}
