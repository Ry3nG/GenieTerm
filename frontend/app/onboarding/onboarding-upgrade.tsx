// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo";
import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import {
    CurrentOnboardingVersion,
    isOnboardingCurrent,
    OnboardingGradientBg,
} from "@/app/onboarding/onboarding-common";
import { FeatureItem, FeatureRow } from "@/app/onboarding/onboarding-tour";
import { ClientModel } from "@/app/store/client-model";
import { getApi, globalStore } from "@/app/store/global";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

const ReleaseNotesUrl = "https://github.com/Ry3nG/GenieTerm/releases/tag/v1.0.0";

const UpgradeHighlights: FeatureItem[] = [
    {
        icon: "fa-feather",
        title: "Much lighter",
        description: "Tabs share one renderer per window. Five tabs use about 700 MB instead of 1.2 GB.",
    },
    {
        icon: "fa-location-dot",
        title: "Knows where you are",
        description: "Terminal headers show the working directory, and tabs name themselves after it.",
    },
    {
        icon: "fa-magnifying-glass",
        title: "A command palette worth opening",
        description: "Search by name, keyword or initials. Recent commands come first; saved hosts are one Enter away.",
    },
    {
        icon: "fa-arrow-down-up-across-line",
        title: "Clearer transfers",
        description: "Every upload and download is one row with progress, status, and the reason if it fails.",
    },
];

function UpgradeNotes() {
    return (
        <div className="flex flex-col gap-5">
            {UpgradeHighlights.map((item) => (
                <FeatureRow key={item.title} size="lg" {...item} />
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
        if (isOnboardingCurrent(lastVersion)) {
            globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        }
    }, [lastVersion]);

    useEffect(() => {
        disableGlobalKeybindings();
        return () => {
            enableGlobalKeybindings();
        };
    }, []);

    if (isOnboardingCurrent(lastVersion)) {
        return null;
    }

    const doClose = () => {
        globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        setTimeout(() => {
            globalRefocus();
        }, 10);
    };

    const handleClose = () => {
        const clientId = ClientModel.getInstance().clientId;
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:lastversion": CurrentOnboardingVersion },
        });
        doClose();
    };

    return (
        <FlexiModal className="w-[560px] rounded-[10px] !p-[30px] relative overflow-hidden bg-panel">
            <OnboardingGradientBg />
            <div className="relative z-10 flex flex-col w-full gap-6">
                <header className="flex flex-col gap-2 items-center unselectable">
                    <div className="mb-2.5">
                        <Logo />
                    </div>
                    <div className="text-[25px] font-normal text-foreground">GenieTerm 1.0</div>
                    <div className="text-[14px] text-secondary">What's new since your last update.</div>
                </header>
                <UpgradeNotes />
                <footer className="flex flex-col items-center gap-3 unselectable">
                    <div className="[&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm">
                        <Button className="font-[600] cursor-pointer" onClick={handleClose}>
                            Continue
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
