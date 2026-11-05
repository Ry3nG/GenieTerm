// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo";
import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { OnboardingGradientBg } from "@/app/onboarding/onboarding-common";
import { setClientMeta } from "@/app/onboarding/onboarding-model";
import { FeatureRow } from "@/app/onboarding/onboarding-tour";
import { ClientModel } from "@/app/store/client-model";
import { getApi, globalStore } from "@/app/store/global";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { FeatureTourModel } from "./feature-tour-model";
import { CurrentOnboardingVersion, isOlderThan, UpgradeReleases, WhatsNewTitle } from "./whatsnew";

const ReleaseNotesUrl = `https://github.com/Ry3nG/GenieTerm/releases/tag/${CurrentOnboardingVersion}`;

function UpgradeNotes({ lastVersion = "v0.0.0" }: { lastVersion?: string }) {
    const unseen = UpgradeReleases.filter((release) => isOlderThan(lastVersion, release.version));
    const releases = unseen.length ? unseen : UpgradeReleases.slice(0, 1);
    return (
        <div className="flex flex-col gap-6">
            {releases.map((release, index) => (
                <section key={release.version} className="flex flex-col gap-4">
                    {(releases.length > 1 || index > 0) && (
                        <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                            {index === 0 ? `New in ${release.version.slice(1)}` : `In ${release.version.slice(1)}`}
                        </div>
                    )}
                    {release.items.map((item) => (
                        <FeatureRow key={item.title} size="lg" {...item} />
                    ))}
                </section>
            ))}
        </div>
    );
}

const UpgradeOnboardingModal = () => {
    const clientData = useAtomValue(ClientModel.getInstance().clientAtom);
    const initialVersionRef = useRef<string | null>(null);

    if (initialVersionRef.current == null) {
        initialVersionRef.current = clientData.meta?.["onboarding:lastversion"] ?? "v0.0.0";
    }

    const lastVersion = initialVersionRef.current;

    useEffect(() => {
        disableGlobalKeybindings();
        return () => {
            enableGlobalKeybindings();
        };
    }, []);

    const doClose = () => {
        globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        setTimeout(() => {
            globalRefocus();
        }, 10);
    };

    const handleStartFeatureTour = async () => {
        await setClientMeta({ "onboarding:lastversion": CurrentOnboardingVersion });
        globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        FeatureTourModel.getInstance().start();
    };

    const handleClose = async () => {
        await setClientMeta({
            "onboarding:lastversion": CurrentOnboardingVersion,
        });
        doClose();
    };

    return (
        <FlexiModal className="w-[560px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-y-auto rounded-[10px] !p-[24px] relative bg-panel">
            <OnboardingGradientBg />
            <div className="relative z-10 flex flex-col w-full gap-6">
                <header className="flex flex-col gap-2 items-center unselectable">
                    <div className="mb-2.5">
                        <Logo />
                    </div>
                    <div className="text-[25px] font-normal text-foreground">{WhatsNewTitle}</div>
                    <div className="text-[14px] text-secondary">What's new since your last update.</div>
                </header>
                <div className="max-h-[52vh] overflow-y-auto">
                    <UpgradeNotes lastVersion={lastVersion} />
                </div>
                <footer className="flex flex-col items-center gap-3 unselectable">
                    <div className="flex items-center gap-2.5 [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm">
                        <Button className="grey font-[600] cursor-pointer" onClick={handleClose}>
                            Close
                        </Button>
                        <Button className="font-[600] cursor-pointer" onClick={handleStartFeatureTour}>
                            Explore features
                        </Button>
                    </div>
                    <button
                        className="cursor-pointer text-[12px] text-muted transition-colors hover:text-foreground"
                        onClick={() => getApi().openExternal(ReleaseNotesUrl)}
                    >
                        Read the release notes
                    </button>
                </footer>
            </div>
        </FlexiModal>
    );
};

UpgradeOnboardingModal.displayName = "UpgradeOnboardingModal";

export { UpgradeNotes, UpgradeOnboardingModal };
