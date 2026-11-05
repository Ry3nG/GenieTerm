// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isOlderThan } from "@/app/onboarding/whatsnew";
import { ClientModel } from "@/app/store/client-model";
import { globalStore } from "@/app/store/jotaiStore";
import { atoms, globalPrimaryTabStartup } from "@/store/global";
import { modalsModel } from "@/store/modalmodel";
import * as jotai from "jotai";
import { Suspense, useEffect, useRef } from "react";
import { getModalComponent } from "./modalregistry";

const ModalsRenderer = () => {
    const clientData = jotai.useAtomValue(ClientModel.getInstance().clientAtom);
    const [newInstallOnboardingOpen, setNewInstallOnboardingOpen] = jotai.useAtom(modalsModel.newInstallOnboardingOpen);
    const upgradeOnboardingOpen = jotai.useAtomValue(modalsModel.upgradeOnboardingOpen);
    const [modals] = jotai.useAtom(modalsModel.modalsAtom);
    const checkedStartup = useRef(false);
    const rtn: React.ReactElement[] = [];
    for (const modal of modals) {
        const ModalComponent = getModalComponent(modal.displayName);
        if (ModalComponent) {
            rtn.push(<ModalComponent key={modal.displayName} {...modal.props} />);
        }
    }
    if (newInstallOnboardingOpen) {
        const NewInstallOnboardingModal = getModalComponent("NewInstallOnboardingModal");
        rtn.push(<NewInstallOnboardingModal key="NewInstallOnboardingModal" />);
    }
    if (upgradeOnboardingOpen) {
        const UpgradeOnboardingModal = getModalComponent("UpgradeOnboardingModal");
        rtn.push(<UpgradeOnboardingModal key="UpgradeOnboardingModal" />);
    }
    useEffect(() => {
        if (!clientData || checkedStartup.current) return;
        checkedStartup.current = true;
        if (!clientData.tosagreed) {
            setNewInstallOnboardingOpen(true);
        } else if (globalPrimaryTabStartup && isOlderThan(clientData.meta?.["onboarding:lastversion"])) {
            globalStore.set(modalsModel.upgradeOnboardingOpen, true);
        }
    }, [clientData]);

    useEffect(() => {
        globalStore.set(atoms.modalOpen, rtn.length > 0);
    }, [rtn]);

    return <Suspense fallback={null}>{rtn}</Suspense>;
};

export { ModalsRenderer };
