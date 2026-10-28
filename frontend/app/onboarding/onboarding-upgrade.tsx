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
import { setClientMeta } from "@/app/onboarding/onboarding-model";
import { FeatureItem, FeatureRow } from "@/app/onboarding/onboarding-tour";
import { ClientModel } from "@/app/store/client-model";
import { getApi, globalStore } from "@/app/store/global";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import coerce from "semver/functions/coerce";
import lt from "semver/functions/lt";
import { FeatureTourModel } from "./feature-tour-model";

const ReleaseNotesUrl = "https://github.com/Ry3nG/GenieTerm/releases/latest";

type UpgradeRelease = { version: string; items: FeatureItem[] };

// 1.4 adds no onboarding step, so 1.3 users get it through the update prompt and the offer
// itself; people coming from older versions see it here with everything else they missed.
const UpgradeReleases: UpgradeRelease[] = [
    {
        version: "v1.6.0",
        items: [
            {
                icon: "fa-clock-rotate-left",
                title: "Command history and recipes",
                description:
                    "Find earlier commands by host and folder. Save commands with arguments, then review and insert them at your prompt.",
            },
            {
                icon: "fa-magnifying-glass",
                title: "Search command output",
                description: "Inspect, search and copy a snapshot of one command's output from the terminal menu.",
            },
            {
                icon: "fa-table-columns",
                title: "Saved workspace setups",
                description:
                    "Save your pane layout, hosts and folders in the workspace menu, then open a fresh workspace from that setup.",
            },
            {
                icon: "fa-server",
                title: "Remote sessions and saved forwards",
                description:
                    "Find durable SSH sessions in Host and save named port forwards, with optional restoration on connection.",
            },
            {
                icon: "fa-copy",
                title: "Batch file operations",
                description:
                    "Select multiple files and folders to copy or download together, with progress, retry and name-conflict choices.",
            },
        ],
    },
    {
        version: "v1.4.0",
        items: [
            {
                icon: "fa-globe",
                title: "Open remote servers here",
                description:
                    "When TensorBoard, Jupyter or a dev server on an SSH host prints its localhost URL, one click forwards the port and opens it.",
            },
        ],
    },
    {
        version: "v1.3.0",
        items: [
            {
                icon: "fa-compass",
                title: "Quick Start",
                description:
                    "A one-minute tour inside your own terminal: run a command, ask Command AI, open a folder. It moves on when you do.",
            },
            {
                icon: "fa-lightbulb",
                title: "Tips when they help",
                description:
                    "The first time a command fails, GenieTerm points to the fix. Connect to a server and it shows where its files and GPUs are. Once each.",
            },
        ],
    },
    {
        version: "v1.2.0",
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

function shortVersion(version: string): string {
    const v = coerce(version);
    return v == null ? version : `${v.major}.${v.minor}`;
}

function UpgradeNotes({ lastVersion = "v0.0.0" }: { lastVersion?: string }) {
    const releases = UpgradeReleases.filter((release) => isOlderThan(lastVersion, release.version));
    return (
        <div className="flex flex-col gap-6">
            {releases.map((release, index) => (
                <section key={release.version} className="flex flex-col gap-4">
                    {(releases.length > 1 || index > 0) && (
                        <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                            {index === 0
                                ? `New in ${shortVersion(release.version)}`
                                : `In ${shortVersion(release.version)}`}
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

    const handleStartFeatureTour = () => {
        setClientMeta({ "onboarding:lastversion": CurrentOnboardingVersion });
        globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        FeatureTourModel.getInstance().start();
    };

    const handleNotNow = () => {
        setClientMeta({
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
                    <div className="text-[25px] font-normal text-foreground">
                        GenieTerm {shortVersion(UpgradeReleases[0].version)}
                    </div>
                    <div className="text-[14px] text-secondary">What's new since your last update.</div>
                </header>
                <div className="max-h-[52vh] overflow-y-auto">
                    <UpgradeNotes lastVersion={lastVersion} />
                </div>
                <footer className="flex flex-col items-center gap-3 unselectable">
                    <div className="flex items-center gap-2.5 [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm">
                        <Button className="grey font-[600] cursor-pointer" onClick={handleNotNow}>
                            Not Now
                        </Button>
                        <Button className="font-[600] cursor-pointer" onClick={handleStartFeatureTour}>
                            Try new features
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
