// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { lazy } from "react";

const MessageModal = lazy(() => import("./messagemodal").then((m) => ({ default: m.MessageModal })));
const AboutModal = lazy(() => import("./about").then((m) => ({ default: m.AboutModal })));
const CommandPalette = lazy(() => import("./commandpalette").then((m) => ({ default: m.CommandPalette })));
const KeybindingsModal = lazy(() => import("./keybindingseditor").then((m) => ({ default: m.KeybindingsModal })));
const SettingsModal = lazy(() => import("./settingseditor").then((m) => ({ default: m.SettingsModal })));

const NewInstallOnboardingModal = lazy(() =>
    import("@/app/onboarding/onboarding").then(({ NewInstallOnboardingModal }) => ({
        default: NewInstallOnboardingModal,
    }))
);
const UpgradeOnboardingModal = lazy(() =>
    import("@/app/onboarding/onboarding-upgrade").then(({ UpgradeOnboardingModal }) => ({
        default: UpgradeOnboardingModal,
    }))
);
const UserInputModal = lazy(() =>
    import("./userinputmodal").then(({ UserInputModal }) => ({ default: UserInputModal }))
);

const modalRegistry: { [key: string]: React.ComponentType<any> } = {
    CommandPalette,
    KeybindingsModal,
    SettingsModal,
    NewInstallOnboardingModal,
    UpgradeOnboardingModal,
    UserInputModal,
    AboutModal,
    MessageModal,
};

export const getModalComponent = (key: string): React.ComponentType<any> | undefined => {
    return modalRegistry[key];
};
