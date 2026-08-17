// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo";
import { InitPage, NoTelemetryStarPage } from "@/app/onboarding/onboarding";
import { OnboardingGradientBg } from "@/app/onboarding/onboarding-common";
import { DurableSessionPage } from "@/app/onboarding/onboarding-durable";
import { CommandBlocksPage, FilesPage } from "@/app/onboarding/onboarding-features";
import { StarAskPage } from "@/app/onboarding/onboarding-starask";
import { UpgradeNotes } from "@/app/onboarding/onboarding-upgrade";

function OnboardingModalWrapper({ width, children }: { width: string; children: React.ReactNode }) {
    return (
        <div className={`${width} rounded-[10px] p-[30px] relative overflow-hidden bg-panel`}>
            <OnboardingGradientBg />
            <div className="relative z-10 flex flex-col w-full h-full">{children}</div>
        </div>
    );
}

function OnboardingFeaturesV() {
    const noop = () => {};
    return (
        <div className="flex flex-col w-full gap-8">
            <OnboardingModalWrapper width="w-[560px]">
                <InitPage isCompact={false} telemetryUpdateFn={async () => {}} />
            </OnboardingModalWrapper>
            <OnboardingModalWrapper width="w-[560px]">
                <NoTelemetryStarPage isCompact={false} />
            </OnboardingModalWrapper>
            <OnboardingModalWrapper width="w-[800px]">
                <DurableSessionPage onNext={noop} onSkip={noop} onPrev={noop} />
            </OnboardingModalWrapper>
            <OnboardingModalWrapper width="w-[800px]">
                <CommandBlocksPage onNext={noop} onSkip={noop} onPrev={noop} />
            </OnboardingModalWrapper>
            <OnboardingModalWrapper width="w-[800px]">
                <FilesPage onFinish={noop} onPrev={noop} />
            </OnboardingModalWrapper>
        </div>
    );
}

function UpgradeNotesV() {
    return (
        <OnboardingModalWrapper width="w-[560px]">
            <header className="flex flex-col gap-2 items-center unselectable mb-6">
                <Logo />
                <div className="text-[25px] font-normal text-foreground">What's in GenieTerm</div>
            </header>
            <UpgradeNotes />
        </OnboardingModalWrapper>
    );
}

function StarAskV() {
    const noop = () => {};
    return (
        <OnboardingModalWrapper width="w-[500px]">
            <StarAskPage onClose={noop} />
        </OnboardingModalWrapper>
    );
}

export function OnboardingPreview() {
    return (
        <div className="w-full max-w-[1300px] py-10 px-4 flex flex-col gap-8">
            <div className="text-sm font-mono text-muted">Onboarding features</div>
            <OnboardingFeaturesV />
            <div className="text-sm font-mono text-muted mt-6">Upgrade notes</div>
            <UpgradeNotesV />
            <div className="text-sm font-mono text-muted mt-6">Onboarding star ask</div>
            <StarAskV />
        </div>
    );
}
