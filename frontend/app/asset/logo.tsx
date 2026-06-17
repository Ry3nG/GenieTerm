// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import logoUrl from "./genieterm-logo.png";

export default function Logo({ className }: { className?: string }) {
    return (
        <img
            src={logoUrl}
            alt="GenieTerm"
            className={["h-12 w-12 select-none rounded-[22%] border-0", className].filter(Boolean).join(" ")}
            draggable={false}
        />
    );
}
