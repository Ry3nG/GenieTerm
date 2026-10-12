// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { MetaKeyAtomFnType, SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type GeneralSettingKey =
    | "app:icon"
    | "term:fontsize"
    | "term:fontfamily"
    | "term:cursor"
    | "term:cursorblink"
    | "app:tabbar"
    | "term:presentation"
    | "term:copyonselect"
    | "app:rightclickpaste"
    | "term:bellindicator"
    | "term:bellsound"
    | "term:notifyafter"
    | "term:scrollback"
    | "term:commandcomposer"
    | "commandai:engine"
    | "commandai:model"
    | "commandai:baseurl"
    | "commandai:includeoutput"
    | "commandai:inline"
    | "term:durable"
    | "term:forwardoffer"
    | "conn:wshenabled"
    | "conn:askbeforewshinstall"
    | "app:confirmquit"
    | "window:confirmclose"
    | "window:savelastwindow"
    | "window:tilegapsize"
    | "autoupdate:enabled"
    | "autoupdate:installonquit";

export type WaveConfigEnv = WaveEnvSubset<{
    electron: {
        getAboutModalDetails: WaveEnv["electron"]["getAboutModalDetails"];
        getConfigDir: WaveEnv["electron"]["getConfigDir"];
        getPlatform: WaveEnv["electron"]["getPlatform"];
        setAppIconVariant: WaveEnv["electron"]["setAppIconVariant"];
    };
    rpc: {
        FileInfoCommand: WaveEnv["rpc"]["FileInfoCommand"];
        FileReadCommand: WaveEnv["rpc"]["FileReadCommand"];
        FileWriteCommand: WaveEnv["rpc"]["FileWriteCommand"];
        ConnListCommand: WaveEnv["rpc"]["ConnListCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
        SetConnectionsConfigCommand: WaveEnv["rpc"]["SetConnectionsConfigCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
        GetSecretsLinuxStorageBackendCommand: WaveEnv["rpc"]["GetSecretsLinuxStorageBackendCommand"];
        GetSecretsNamesCommand: WaveEnv["rpc"]["GetSecretsNamesCommand"];
        GetSecretsCommand: WaveEnv["rpc"]["GetSecretsCommand"];
        SetSecretsCommand: WaveEnv["rpc"]["SetSecretsCommand"];
        CommandAiStatusCommand: WaveEnv["rpc"]["CommandAiStatusCommand"];
        CommandAiModelsCommand: WaveEnv["rpc"]["CommandAiModelsCommand"];
        CommandAiRunCommand: WaveEnv["rpc"]["CommandAiRunCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"file">;
    getSettingsKeyAtom: SettingsKeyAtomFnType<GeneralSettingKey>;
    isWindows: WaveEnv["isWindows"];
}>;
