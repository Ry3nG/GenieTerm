// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo";
import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { CurrentOnboardingVersion, OnboardingGradientBg } from "@/app/onboarding/onboarding-common";
import { OnboardingModel, setClientMeta } from "@/app/onboarding/onboarding-model";
import { FeatureItem, FeatureRow } from "@/app/onboarding/onboarding-tour";
import { ClientModel } from "@/app/store/client-model";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import * as services from "@/store/services";
import { fireAndForget } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useRef, useState } from "react";
import { debounce } from "throttle-debounce";

const WelcomePillars: FeatureItem[] = [
    {
        icon: "fa-layer-group",
        title: "Command blocks",
        description: "Every command keeps its status, duration and output together, one click from copy or re-run.",
    },
    {
        icon: "fa-shield-halved",
        title: "Durable SSH",
        description: "Remote sessions survive sleep, network drops and restarts, and reconnect on their own.",
    },
    {
        icon: "fa-server",
        title: "Remote files and hosts",
        description: "Browse and edit files, watch GPUs and processes, and forward ports on any host.",
    },
];

const InitPage = ({ isCompact }: { isCompact: boolean }) => {
    const clientData = useAtomValue(ClientModel.getInstance().clientAtom);
    const setNewInstallOnboardingOpen = useSetAtom(modalsModel.newInstallOnboardingOpen);

    const finishWelcome = async (startQuickStart: boolean) => {
        // the renderer reopens this modal on any client update until tosagreed lands
        if (!clientData?.tosagreed) {
            await services.ClientService.AgreeTos();
        }
        setClientMeta({
            "onboarding:lastversion": CurrentOnboardingVersion,
            ...(startQuickStart ? {} : { "onboarding:quickstart": "dismissed" }),
        });
        setNewInstallOnboardingOpen(false);
        if (startQuickStart) {
            OnboardingModel.getInstance().start();
            return;
        }
        setTimeout(() => {
            globalRefocus();
        }, 10);
    };

    return (
        <div className="flex flex-col h-full">
            <header
                className={`flex flex-col gap-2 border-b-0 p-0 ${isCompact ? "mt-1 mb-4" : "mb-9"} w-full unselectable flex-shrink-0`}
            >
                <div className={`${isCompact ? "" : "mb-2.5"} flex justify-center`}>
                    <Logo />
                </div>
                <div className="text-center text-[25px] font-normal text-foreground">Welcome to GenieTerm</div>
                <div className="text-center text-[14px] text-secondary">The terminal for people who live in SSH.</div>
            </header>
            <OverlayScrollbarsComponent
                className="flex-1 overflow-y-auto min-h-0"
                options={{ scrollbars: { autoHide: "never" } }}
            >
                <div className="flex flex-col gap-5 w-full mb-5 unselectable">
                    {WelcomePillars.map((pillar) => (
                        <FeatureRow key={pillar.title} size="lg" {...pillar} />
                    ))}
                </div>
            </OverlayScrollbarsComponent>
            <footer className={`unselectable flex-shrink-0 ${isCompact ? "mt-2" : "mt-5"}`}>
                <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm">
                    <Button className="font-[600]" onClick={() => fireAndForget(() => finishWelcome(true))}>
                        Get Started
                    </Button>
                </div>
                <div className="mt-2.5 text-center text-[12.5px] text-secondary">
                    A one-minute Quick Start, right in your terminal.{" "}
                    <button
                        className="cursor-pointer text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
                        onClick={() => fireAndForget(() => finishWelcome(false))}
                    >
                        Skip
                    </button>
                </div>
                <div className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-muted">
                    <i className="fa-solid fa-lock text-[10px]" aria-hidden="true" />
                    <span>Runs on your machine. No account, no usage data.</span>
                </div>
            </footer>
        </div>
    );
};

const NewInstallOnboardingModal = () => {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const [isCompact, setIsCompact] = useState<boolean>(window.innerHeight < 800);

    const updateModalHeight = () => {
        const windowHeight = window.innerHeight;
        setIsCompact(windowHeight < 800);
        if (modalRef.current) {
            // measure the content's natural height, not a height clamped for the previous page
            modalRef.current.style.height = "auto";
            const modalHeight = modalRef.current.offsetHeight;
            const maxHeight = windowHeight * 0.9;
            if (maxHeight < modalHeight) {
                modalRef.current.style.height = `${maxHeight}px`;
            } else {
                modalRef.current.style.height = "auto";
            }
        }
    };

    useEffect(() => {
        updateModalHeight();
        const debouncedUpdateModalHeight = debounce(150, updateModalHeight);
        window.addEventListener("resize", debouncedUpdateModalHeight);
        return () => {
            window.removeEventListener("resize", debouncedUpdateModalHeight);
        };
    }, []);

    useEffect(() => {
        disableGlobalKeybindings();
        return () => {
            enableGlobalKeybindings();
        };
    }, []);

    const paddingClass = isCompact ? "!py-3 !px-[30px]" : "!p-[30px]";

    return (
        <FlexiModal className={`w-[560px] rounded-[10px] ${paddingClass} relative overflow-hidden`} ref={modalRef}>
            <OnboardingGradientBg />
            <div className="flex flex-col w-full h-full relative z-10">
                <InitPage isCompact={isCompact} />
            </div>
        </FlexiModal>
    );
};

NewInstallOnboardingModal.displayName = "NewInstallOnboardingModal";

export { InitPage, NewInstallOnboardingModal };
