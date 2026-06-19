// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_13_0_Content = () => {
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">
                    GenieTerm v0.13 brings a redesigned configuration system, better secret management, and improved
                    terminal functionality.
                </p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-key"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Secrets & Credentials</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>Store sensitive values in GenieTerm's secret store</li>
                            <li>Manage credentials from the configuration widget</li>
                            <li>Use secrets from CLI workflows without exposing raw values in config files</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sliders"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Configuration Widget</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>New Config Interface</strong> - Dedicated widget accessible from the sidebar
                            </li>
                            <li>
                                <strong>Better Organization</strong> - Browse and edit settings with improved validation
                                and error handling
                            </li>
                            <li>
                                <strong>Integrated Secrets</strong> - Manage API keys and credentials from the config
                                widget
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Terminal Updates</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Bracketed Paste Mode</strong> - Enabled by default for better multi-line paste
                                behavior
                            </li>
                            <li>
                                <strong>Windows Paste Fix</strong> - Ctrl+V now works as standard paste on Windows
                            </li>
                            <li>
                                <strong>SSH Password Storage</strong> - Store SSH passwords in GenieTerm's secret store
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_13_0_Content.displayName = "UpgradeOnboardingModal_v0_13_0_Content";

export { UpgradeOnboardingModal_v0_13_0_Content };
