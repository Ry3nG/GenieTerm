// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const ConnectionAwareViews = new Set(["host", "sysinfo", "processviewer", "preview"]);

function isLocalConn(conn: string): boolean {
    return conn == null || conn === "" || conn === "local" || conn.startsWith("local:");
}

// Files and Host open on the machine you are working on: when the focused block is on a remote
// connection, the widget opens there (and Files opens in that terminal's directory).
export function makeWidgetBlockDef(blockdef: BlockDef, focusedMeta: MetaType): BlockDef {
    const meta = blockdef?.meta ?? {};
    const view = meta.view as string;
    if (!ConnectionAwareViews.has(view) || meta.connection != null || focusedMeta == null) {
        return blockdef;
    }
    const conn = focusedMeta.connection as string;
    const cwd = focusedMeta["cmd:cwd"] as string;
    const next: MetaType = { ...meta };
    if (!isLocalConn(conn)) {
        next.connection = conn;
    }
    if (view === "preview" && (meta.file == null || meta.file === "~") && cwd) {
        next.file = cwd;
    }
    if (next.connection === meta.connection && next.file === meta.file) {
        return blockdef;
    }
    return { ...blockdef, meta: next };
}
