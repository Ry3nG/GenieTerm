// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MessageModal } from "@/app/modals/messagemodal";
import { AboutModal } from "./about";
import { CommandPalette } from "./commandpalette";
import { KeybindingsModal } from "./keybindingseditor";
import { SettingsModal } from "./settingseditor";
import { lazy } from "react";

const NewInstallOnboardingModal = lazy(() =>
    import("@/app/onboarding/onboarding").then(({ NewInstallOnboardingModal }) => ({ default: NewInstallOnboardingModal }))
);
const UpgradeOnboardingModal = lazy(() =>
    import("@/app/onboarding/onboarding-upgrade").then(({ UpgradeOnboardingModal }) => ({ default: UpgradeOnboardingModal }))
);
const UserInputModal = lazy(() => import("./userinputmodal").then(({ UserInputModal }) => ({ default: UserInputModal })));

const modalRegistry: { [key: string]: React.ComponentType<any> } = {
    [CommandPalette.displayName || "CommandPalette"]: CommandPalette,
    [KeybindingsModal.displayName || "KeybindingsModal"]: KeybindingsModal,
    [SettingsModal.displayName || "SettingsModal"]: SettingsModal,
    NewInstallOnboardingModal,
    UpgradeOnboardingModal,
    UserInputModal,
    [AboutModal.displayName || "AboutModal"]: AboutModal,
    [MessageModal.displayName || "MessageModal"]: MessageModal,
};

export const getModalComponent = (key: string): React.ComponentType<any> | undefined => {
    return modalRegistry[key];
};
