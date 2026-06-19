// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { MetaKeyAtomFnType, SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type WaveConfigEnv = WaveEnvSubset<{
    electron: {
        getConfigDir: WaveEnv["electron"]["getConfigDir"];
        getPlatform: WaveEnv["electron"]["getPlatform"];
        setAppIconVariant: WaveEnv["electron"]["setAppIconVariant"];
    };
    rpc: {
        FileInfoCommand: WaveEnv["rpc"]["FileInfoCommand"];
        FileReadCommand: WaveEnv["rpc"]["FileReadCommand"];
        FileWriteCommand: WaveEnv["rpc"]["FileWriteCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
        GetSecretsLinuxStorageBackendCommand: WaveEnv["rpc"]["GetSecretsLinuxStorageBackendCommand"];
        GetSecretsNamesCommand: WaveEnv["rpc"]["GetSecretsNamesCommand"];
        GetSecretsCommand: WaveEnv["rpc"]["GetSecretsCommand"];
        SetSecretsCommand: WaveEnv["rpc"]["SetSecretsCommand"];
        RecordTEventCommand: WaveEnv["rpc"]["RecordTEventCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"file">;
    getSettingsKeyAtom: SettingsKeyAtomFnType<"app:theme" | "app:icon">;
    isWindows: WaveEnv["isWindows"];
}>;
