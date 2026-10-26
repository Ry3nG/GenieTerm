// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ShellType } from "./completion/types";

export type ShellIntegrationReport = {
    // the shell started its integration script but reported integration:false
    integrationDisabled?: boolean;
    shellType?: ShellType;
};

export function getShellIntegrationRecovery(status: ConnStatus, report?: ShellIntegrationReport) {
    const connection = status?.connection;
    const remote = connection && connection !== "local" && !connection.startsWith("local:");
    if (remote && status.status !== "connected") {
        return null;
    }
    if (remote && !status.wshenabled) {
        if (status.nowshreason === "installing wsh in background" && !status.wsherror) {
            return { message: "Installing shell integration. You can keep using this terminal.", action: null };
        }
        const disabled =
            status.nowshreason === "conn:wshenabled set to false" ||
            status.nowshreason === "user selected not to install wsh extensions";
        return {
            message: disabled
                ? "Shell integration is disabled for this connection. Command blocks need it enabled."
                : `Shell integration is unavailable: ${status.wsherror || status.nowshreason || "helper not ready"}.`,
            action: disabled ? "enable" : "reconnect",
        };
    }
    // the shell explicitly reported it can't provide integration; restarting it would
    // just report the same thing again, so don't offer that.
    if (report?.integrationDisabled) {
        if (report.shellType === "pwsh") {
            return {
                message: "PowerShell command blocks need PSReadLine enabled in an interactive terminal.",
                action: null,
            };
        }
        return {
            message: "This shell reported that integration is unavailable, so command blocks are off.",
            action: null,
        };
    }
    return {
        message:
            "This shell has not reported integration. Restart it to load integration; custom shells and multiplexers may not support command blocks.",
        action: "restart",
    };
}
