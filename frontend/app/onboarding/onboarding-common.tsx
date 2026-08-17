// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import semver from "semver";

export const CurrentOnboardingVersion = "v0.4.80";

const WaveLegacyOnboardingMin = "0.12.0";
const WaveLegacyOnboardingMax = "0.15.0";

export function isOnboardingCurrent(lastVersion: string): boolean {
    const last = semver.coerce(lastVersion ?? "0.0.0");
    const current = semver.coerce(CurrentOnboardingVersion);
    if (last == null || current == null) {
        return false;
    }
    if (semver.gte(last, WaveLegacyOnboardingMin) && semver.lt(last, WaveLegacyOnboardingMax)) {
        return true;
    }
    return semver.gte(last, current);
}

export function OnboardingGradientBg() {
    return (
        <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.25] via-transparent to-accent/[0.05] pointer-events-none rounded-[10px]" />
    );
}
