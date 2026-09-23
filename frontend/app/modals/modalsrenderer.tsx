// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isOnboardingCurrent } from "@/app/onboarding/onboarding-common";
import { ClientModel } from "@/app/store/client-model";
import { globalStore } from "@/app/store/jotaiStore";
import { atoms, globalPrimaryTabStartup } from "@/store/global";
import { modalsModel } from "@/store/modalmodel";
import * as jotai from "jotai";
import { Suspense, useEffect } from "react";
import { getModalComponent } from "./modalregistry";

const ModalsRenderer = () => {
    const clientData = jotai.useAtomValue(ClientModel.getInstance().clientAtom);
    const [newInstallOnboardingOpen, setNewInstallOnboardingOpen] = jotai.useAtom(modalsModel.newInstallOnboardingOpen);
    const [upgradeOnboardingOpen, setUpgradeOnboardingOpen] = jotai.useAtom(modalsModel.upgradeOnboardingOpen);
    const [modals] = jotai.useAtom(modalsModel.modalsAtom);
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
        if (!clientData.tosagreed) {
            setNewInstallOnboardingOpen(true);
        }
    }, [clientData]);

    useEffect(() => {
        if (!globalPrimaryTabStartup) {
            return;
        }
        if (!clientData.tosagreed) {
            return;
        }
        const lastVersion = clientData.meta?.["onboarding:lastversion"] ?? "v0.0.0";
        if (!isOnboardingCurrent(lastVersion)) {
            setUpgradeOnboardingOpen(true);
        }
    }, []);
    useEffect(() => {
        globalStore.set(atoms.modalOpen, rtn.length > 0);
    }, [rtn]);

    return <Suspense fallback={null}>{rtn}</Suspense>;
};

export { ModalsRenderer };
