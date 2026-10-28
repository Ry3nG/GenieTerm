// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo";
import { InitPage } from "@/app/onboarding/onboarding";
import { OnboardingGradientBg } from "@/app/onboarding/onboarding-common";
import { OnboardingModel, QuickStartStep } from "@/app/onboarding/onboarding-model";
import {
    CommandAiSheetPhase,
    GuideCard,
    makeQuickStartView,
    makeTipView,
} from "@/app/onboarding/onboarding-quickstart";
import { UpgradeNotes } from "@/app/onboarding/onboarding-upgrade";

function OnboardingModalWrapper({ width, children }: { width: string; children: React.ReactNode }) {
    return (
        <div className={`${width} max-w-full rounded-[10px] p-[30px] relative overflow-hidden bg-panel`}>
            <OnboardingGradientBg />
            <div className="relative z-10 flex flex-col w-full h-full">{children}</div>
        </div>
    );
}

function WelcomeV() {
    return (
        <OnboardingModalWrapper width="w-[560px]">
            <InitPage isCompact={false} />
        </OnboardingModalWrapper>
    );
}

type QuickStartCase = { label: string; step: QuickStartStep; opts?: Partial<QuickStartCaseOpts> };
type QuickStartCaseOpts = {
    typedTry: boolean;
    commandAiSheetOpen: boolean;
    commandAiNeedsSetup: boolean;
    commandAiPhase: CommandAiSheetPhase;
    commandBlocksOff: boolean;
    cwdLinkVisible: boolean;
    cwdLabel: string;
};

const QuickStartCases: QuickStartCase[] = [
    { label: "command", step: "command" },
    { label: "command typed", step: "command", opts: { typedTry: true } },
    { label: "command blocks off", step: "command", opts: { commandBlocksOff: true } },
    { label: "blocks", step: "blocks" },
    { label: "commandai", step: "commandai" },
    { label: "commandai setup", step: "commandai", opts: { commandAiSheetOpen: true, commandAiNeedsSetup: true } },
    { label: "commandai sheet", step: "commandai", opts: { commandAiSheetOpen: true } },
    { label: "commandai asking", step: "commandai", opts: { commandAiSheetOpen: true, commandAiPhase: "pending" } },
    { label: "commandai answered", step: "commandai", opts: { commandAiSheetOpen: true, commandAiPhase: "answered" } },
    { label: "files", step: "files", opts: { cwdLinkVisible: true, cwdLabel: "~/projects/api" } },
    { label: "files fallback", step: "files" },
    { label: "done", step: "done" },
];

function QuickStartCardsV() {
    const model = OnboardingModel.getInstance();
    const noop = () => {};
    return (
        <div className="flex flex-wrap gap-6">
            {QuickStartCases.map((qcase) => {
                const view = makeQuickStartView(qcase.step, {
                    model,
                    targetBlockId: null,
                    isMac: true,
                    typedTry: false,
                    onTypeTry: noop,
                    commandAiSheetOpen: false,
                    commandAiNeedsSetup: false,
                    commandAiPhase: "input",
                    commandBlocksOff: false,
                    cwdLinkVisible: false,
                    ...qcase.opts,
                });
                return (
                    <div key={qcase.label} className="flex flex-col gap-2">
                        <div className="text-xs font-mono text-muted">{qcase.label}</div>
                        <GuideCard content={view.content} onClose={noop} closeLabel="Finish later" />
                    </div>
                );
            })}
            {(["fix", "remote"] as const).map((id) => (
                <div key={id} className="flex flex-col gap-2">
                    <div className="text-xs font-mono text-muted">tip {id}</div>
                    <GuideCard
                        content={makeTipView({ id, connection: "gpu-01" }, model).content}
                        onClose={noop}
                        closeLabel="Close tip"
                    />
                </div>
            ))}
        </div>
    );
}

function UpgradeNotesV() {
    return (
        <OnboardingModalWrapper width="w-[560px]">
            <header className="flex flex-col gap-2 items-center unselectable mb-6">
                <Logo />
                <div className="text-[25px] font-normal text-foreground">GenieTerm 1.6</div>
                <div className="text-[14px] text-secondary">What's new since your last update.</div>
            </header>
            <UpgradeNotes lastVersion="v1.1.0" />
        </OnboardingModalWrapper>
    );
}

export function OnboardingPreview() {
    return (
        <div className="w-full max-w-[1300px] py-10 px-4 flex flex-col gap-8">
            <div className="text-sm font-mono text-muted">Welcome</div>
            <WelcomeV />
            <div className="text-sm font-mono text-muted mt-6">Quick Start</div>
            <QuickStartCardsV />
            <div className="text-sm font-mono text-muted mt-6">Upgrade notes</div>
            <UpgradeNotesV />
        </div>
    );
}
