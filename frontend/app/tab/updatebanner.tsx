// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveEnv, WaveEnvSubset, useWaveEnv } from "@/app/waveenv/waveenv";
import { Tooltip } from "@/element/tooltip";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";

type UpdateBannerEnv = WaveEnvSubset<{
    electron: {
        installAppUpdate: WaveEnv["electron"]["installAppUpdate"];
    };
    atoms: {
        updaterStatusAtom: WaveEnv["atoms"]["updaterStatusAtom"];
    };
}>;

export function getUpdateStatusMessage(status: UpdaterStatus): string | null {
    switch (status) {
        case "available":
        case "downloading":
            return "Downloading Update";
        case "ready":
            return "Install Update";
        case "installing":
            return "Installing Update";
        default:
            return null;
    }
}

export function getUpdateStatusIcon(status: UpdaterStatus): string {
    switch (status) {
        case "ready":
            return "fa fa-refresh";
        case "installing":
            return "fa fa-spinner fa-spin";
        default:
            return "fa fa-download";
    }
}

export function isUpdateStatusActionable(status: UpdaterStatus): boolean {
    return status === "ready";
}

export function getUpdateStatusTooltip(status: UpdaterStatus, message: string): string {
    if (status === "ready") {
        return "Restart GenieTerm to install update";
    }
    if (status === "downloading" || status === "available") {
        return "Downloading update in the background";
    }
    return message;
}

const UpdateStatusBannerComponent = () => {
    const env = useWaveEnv<UpdateBannerEnv>();
    const appUpdateStatus = useAtomValue(env.atoms.updaterStatusAtom);
    const updateStatusMessage = getUpdateStatusMessage(appUpdateStatus);

    const onClick = useCallback(() => {
        env.electron.installAppUpdate();
    }, [env]);

    if (!updateStatusMessage) {
        return null;
    }

    const canAct = isUpdateStatusActionable(appUpdateStatus);
    const tooltipContent = getUpdateStatusTooltip(appUpdateStatus, updateStatusMessage);

    return (
        <Tooltip
            content={tooltipContent}
            placement="bottom"
            divOnClick={canAct ? onClick : undefined}
            divClassName={`flex items-center gap-1 px-2 mb-1 h-[22px] text-xs font-medium text-primary bg-accent rounded-sm transition-all ${canAct ? "cursor-pointer hover:bg-accenthover" : ""}`}
            divStyle={{ WebkitAppRegion: "no-drag" } as any}
        >
            <i className={getUpdateStatusIcon(appUpdateStatus)} />
            {updateStatusMessage}
        </Tooltip>
    );
};
UpdateStatusBannerComponent.displayName = "UpdateStatusBannerComponent";

export const UpdateStatusBanner = memo(UpdateStatusBannerComponent);
