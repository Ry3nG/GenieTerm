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
import coerce from "semver/functions/coerce";
import lt from "semver/functions/lt";

const ReleaseNotesUrl = "https://github.com/Ry3nG/GenieTerm/releases/tag/v1.2.0";

type UpgradeRelease = { version: string; title: string; items: FeatureItem[] };

const UpgradeReleases: UpgradeRelease[] = [
    {
        version: "v1.2.0",
        title: "New in 1.2",
        items: [
            {
                icon: "fa-wand-magic-sparkles",
                title: "Command AI, with the AI you already have",
                description:
                    "Describe what you want and get a command to review. It uses your Codex or Claude Code sign-in, or your own API key.",
            },
            {
                icon: "fa-stethoscope",
                title: "Fix and explain",
                description: "The sparkle on a finished command explains it, or says why it failed and how to fix it.",
            },
            {
                icon: "fa-location-crosshairs",
                title: "Knows the machine",
                description: "Commands fit the host's system, distribution and shell, even over SSH.",
            },
            {
                icon: "fa-shield-halved",
                title: "Nothing leaves without you",
                description:
                    "Requests go out only when you ask, with keys and tokens removed. “What’s sent” shows the exact request.",
            },
        ],
    },
    {
        version: "v1.0.0",
        title: "Also since your last update",
        items: [
            {
                icon: "fa-server",
                title: "Host: GPUs, processes and ports",
                description: "One view per machine, from this Mac to a GPU box over SSH. Find it on the widget rail.",
            },
            {
                icon: "fa-arrow-right-to-bracket",
                title: "Port forwarding without ssh -L",
                description: "Forward & open puts Jupyter, TensorBoard or a dev server on localhost in one click.",
            },
            {
                icon: "fa-bell",
                title: "Know when it's done",
                description: "Long commands notify you when they finish while you're looking elsewhere.",
            },
        ],
    },
];

function isOlderThan(lastVersion: string, version: string): boolean {
    const last = coerce(lastVersion ?? "0.0.0");
    const target = coerce(version);
    return last == null || target == null || lt(last, target);
}

function UpgradeNotes({ lastVersion = "v0.0.0" }: { lastVersion?: string }) {
    const releases = UpgradeReleases.filter((release) => isOlderThan(lastVersion, release.version));
    return (
        <div className="flex flex-col gap-6">
            {releases.map((release, index) => (
                <section key={release.version} className="flex flex-col gap-4">
                    {(releases.length > 1 || index > 0) && (
                        <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                            {release.title}
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
                    <div className="text-[25px] font-normal text-foreground">GenieTerm 1.2</div>
                    <div className="text-[14px] text-secondary">What's new since your last update.</div>
                </header>
                <div className="max-h-[52vh] overflow-y-auto">
                    <UpgradeNotes lastVersion={lastVersion} />
                </div>
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
