// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo";
import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { OnboardingGradientBg } from "@/app/onboarding/onboarding-common";
import { OnboardingFeatures } from "@/app/onboarding/onboarding-features";
import { FeatureItem, FeatureRow } from "@/app/onboarding/onboarding-tour";
import { ClientModel } from "@/app/store/client-model";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import * as services from "@/store/services";
import { fireAndForget } from "@/util/util";
import { atom, PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { debounce } from "throttle-debounce";

type PageName = "init" | "features";

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

const pageNameAtom: PrimitiveAtom<PageName> = atom<PageName>("init");

const InitPage = ({ isCompact }: { isCompact: boolean }) => {
    const clientData = useAtomValue(ClientModel.getInstance().clientAtom);
    const setPageName = useSetAtom(pageNameAtom);

    const acceptTos = () => {
        if (!clientData?.tosagreed) {
            fireAndForget(() => services.ClientService.AgreeTos());
        }
        setPageName("features");
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
                <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm [&>button:not(:first-child)]:ml-2.5">
                    <Button className="font-[600]" onClick={acceptTos}>
                        Continue
                    </Button>
                </div>
                <div className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-muted">
                    <i className="fa-solid fa-lock text-[10px]" aria-hidden="true" />
                    <span>Runs on your machine. No account, no usage data.</span>
                </div>
            </footer>
        </div>
    );
};

const FeaturesPage = () => {
    const [newInstallOnboardingOpen, setNewInstallOnboardingOpen] = useAtom(modalsModel.newInstallOnboardingOpen);

    const handleComplete = () => {
        setNewInstallOnboardingOpen(false);
        setTimeout(() => {
            globalRefocus();
        }, 10);
    };

    return <OnboardingFeatures onComplete={handleComplete} />;
};

const NewInstallOnboardingModal = () => {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const [pageName, setPageName] = useAtom(pageNameAtom);
    const clientData = useAtomValue(ClientModel.getInstance().clientAtom);
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
        if (clientData.tosagreed) {
            setPageName("features");
        }
        return () => {
            setPageName("init");
        };
    }, []);

    useEffect(() => {
        updateModalHeight();
        const debouncedUpdateModalHeight = debounce(150, updateModalHeight);
        window.addEventListener("resize", debouncedUpdateModalHeight);
        return () => {
            window.removeEventListener("resize", debouncedUpdateModalHeight);
        };
    }, []);

    // the feature tour is much taller than the welcome page; re-clamp before it paints
    useLayoutEffect(() => {
        updateModalHeight();
    }, [pageName]);

    useEffect(() => {
        disableGlobalKeybindings();
        return () => {
            enableGlobalKeybindings();
        };
    }, []);

    let pageComp: React.JSX.Element = null;
    switch (pageName) {
        case "init":
            pageComp = <InitPage isCompact={isCompact} />;
            break;
        case "features":
            pageComp = <FeaturesPage />;
            break;
    }
    if (pageComp == null) {
        return null;
    }

    const paddingClass = isCompact ? "!py-3 !px-[30px]" : "!p-[30px]";
    const widthClass = pageName === "features" ? "w-[820px]" : "w-[560px]";

    return (
        <FlexiModal className={`${widthClass} rounded-[10px] ${paddingClass} relative overflow-hidden`} ref={modalRef}>
            <OnboardingGradientBg />
            <div className="flex flex-col w-full h-full relative z-10">{pageComp}</div>
        </FlexiModal>
    );
};

NewInstallOnboardingModal.displayName = "NewInstallOnboardingModal";

export { InitPage, NewInstallOnboardingModal };
