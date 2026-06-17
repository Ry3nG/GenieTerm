// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo";
import { OnboardingGradientBg } from "@/app/onboarding/onboarding-common";
import { atoms } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isDev } from "@/util/isdev";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { Modal } from "./modal";

interface AboutModalVProps {
    versionString: string;
    updaterChannel: string;
    onClose: () => void;
}

const AboutModalV = ({ versionString, updaterChannel, onClose }: AboutModalVProps) => {
    const currentDate = new Date();

    return (
        <Modal className="pt-[34px] pb-[34px] overflow-hidden w-[450px]" onClose={onClose}>
            <OnboardingGradientBg />
            <div className="flex flex-col gap-[26px] w-full relative z-10">
                <div className="flex flex-col items-center justify-center gap-4 self-stretch w-full text-center">
                    <Logo />
                    <div className="text-[25px]">GenieTerm</div>
                    <div className="text-secondary text-[13px] leading-5">
                        An open, modern terminal for commands,
                        <br />
                        files, sessions, and remote work
                    </div>
                </div>
                <div className="text-secondary text-[13px] text-center self-stretch w-full leading-6">
                    Version {versionString}
                    <br />
                    Update channel: {updaterChannel}
                </div>
                <div className="grid grid-cols-2 gap-[10px] self-stretch w-full">
                    <a
                        href="https://github.com/Ry3nG/GenieTerm"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border hover:bg-hoverbg transition-colors duration-200 cursor-pointer"
                    >
                        <i className="fa-brands fa-github mr-2"></i>GitHub
                    </a>
                    <a
                        href="https://github.com/Ry3nG/GenieTerm/issues"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border hover:bg-hoverbg transition-colors duration-200 cursor-pointer"
                    >
                        <i className="fa-sharp fa-light fa-circle-exclamation mr-2"></i>Report an issue
                    </a>
                    <a
                        href="https://github.com/wavetermdev/waveterm"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border hover:bg-hoverbg transition-colors duration-200 cursor-pointer"
                    >
                        <i className="fa-sharp fa-light fa-code-fork mr-2"></i>Built on Wave
                    </a>
                    <a
                        href="https://github.com/wavetermdev/waveterm/blob/main/ACKNOWLEDGEMENTS.md"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border hover:bg-hoverbg transition-colors duration-200 cursor-pointer"
                    >
                        <i className="fa-sharp fa-light fa-book mr-2"></i>Acknowledgements
                    </a>
                </div>
                <div className="text-muted text-[12px] text-center self-stretch w-full leading-5">
                    A fork of Wave Terminal (&copy; Command Line Inc.), licensed under Apache-2.0
                    <br />
                    &copy; {currentDate.getFullYear()} GenieTerm
                </div>
            </div>
        </Modal>
    );
};

AboutModalV.displayName = "AboutModalV";

const AboutModal = () => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const versionString = `${fullConfig?.version ?? ""} (${isDev() ? "dev-" : ""}${fullConfig?.buildtime ?? ""})`;
    const updaterChannel = fullConfig?.settings?.["autoupdate:channel"] ?? "latest";

    useEffect(() => {
        fireAndForget(async () => {
            RpcApi.RecordTEventCommand(
                TabRpcClient,
                { event: "action:other", props: { "action:type": "about" } },
                { noresponse: true }
            );
        });
    }, []);

    return (
        <AboutModalV
            versionString={versionString}
            updaterChannel={updaterChannel}
            onClose={() => modalsModel.popModal()}
        />
    );
};

AboutModal.displayName = "AboutModal";

export { AboutModal, AboutModalV };
