// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import coerce from "semver/functions/coerce";
import gte from "semver/functions/gte";
import lt from "semver/functions/lt";

export const CurrentOnboardingVersion = "v1.2.0";

const WaveLegacyOnboardingMin = "0.12.0";
const WaveLegacyOnboardingMax = "0.15.0";

export function isOnboardingCurrent(lastVersion: string): boolean {
    const last = coerce(lastVersion ?? "0.0.0");
    const current = coerce(CurrentOnboardingVersion);
    if (last == null || current == null) {
        return false;
    }
    if (gte(last, WaveLegacyOnboardingMin) && lt(last, WaveLegacyOnboardingMax)) {
        return true;
    }
    return gte(last, current);
}

export function OnboardingGradientBg() {
    return (
        <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.25] via-transparent to-accent/[0.05] pointer-events-none rounded-[10px]" />
    );
}
