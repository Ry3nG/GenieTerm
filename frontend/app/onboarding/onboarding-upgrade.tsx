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
import { StarAskPage } from "@/app/onboarding/onboarding-starask";
import { ClientModel } from "@/app/store/client-model";
import { globalStore } from "@/app/store/global";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";

function UpgradeNotes() {
    return (
        <div className="flex flex-col gap-4 text-secondary leading-6">
            <p className="text-foreground">
                GenieTerm is a semantic terminal for remote work, not a Wave upgrade tour.
            </p>
            <div className="flex items-start gap-3">
                <i className="fa-solid fa-layer-group text-accent mt-1" />
                <p>
                    Commands render as blocks with status, duration, copy, and re-run. Classic xterm stays in Settings.
                </p>
            </div>
            <div className="flex items-start gap-3">
                <i className="fa-solid fa-shield text-accent mt-1" />
                <p>Durable SSH sessions survive laptop sleep and app restarts. Look for the shield on a connection.</p>
            </div>
            <div className="flex items-start gap-3">
                <i className="fa-solid fa-folder text-accent mt-1" />
                <p>
                    Preview, edit, upload, and download local or remote files. Typed helper is{" "}
                    <span className="font-mono text-foreground">genie</span>; <span className="font-mono">wsh</span>{" "}
                    still works.
                </p>
            </div>
        </div>
    );
}

const UpgradeOnboardingModal = () => {
    const clientData = useAtomValue(ClientModel.getInstance().clientAtom);
    const initialVersionRef = useRef<string | null>(null);
    const [showStarAsk, setShowStarAsk] = useState(false);
    const alreadyStarred = clientData?.meta?.["onboarding:githubstar"] === true;

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
        if (alreadyStarred) {
            doClose();
        } else {
            setShowStarAsk(true);
        }
    };

    if (showStarAsk) {
        return (
            <FlexiModal className="w-[500px] rounded-[10px] !p-[30px] relative overflow-hidden bg-panel">
                <OnboardingGradientBg />
                <div className="relative z-10 flex flex-col w-full h-full">
                    <StarAskPage onClose={doClose} page="upgrade" />
                </div>
            </FlexiModal>
        );
    }

    return (
        <FlexiModal className="w-[560px] rounded-[10px] !p-[30px] relative overflow-hidden bg-panel">
            <OnboardingGradientBg />
            <div className="relative z-10 flex flex-col w-full gap-6">
                <header className="flex flex-col gap-2 items-center unselectable">
                    <Logo />
                    <div className="text-[25px] font-normal text-foreground">What's in GenieTerm</div>
                </header>
                <UpgradeNotes />
                <footer className="flex justify-center">
                    <Button className="font-[600] cursor-pointer" onClick={handleClose}>
                        Continue
                    </Button>
                </footer>
            </div>
        </FlexiModal>
    );
};

UpgradeOnboardingModal.displayName = "UpgradeOnboardingModal";

export { UpgradeNotes, UpgradeOnboardingModal };
