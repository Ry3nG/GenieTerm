// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_14_0_Content = () => {
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">
                    GenieTerm v0.14 introduces Durable Sessions. Enable them to keep your remote sessions alive through
                    network interruptions, computer sleep, and restarts — they'll automatically reconnect when your
                    connection is restored.
                </p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-sky-500 fa-sharp fa-solid fa-shield"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        Durable SSH Sessions
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Session Protection</strong> - Programs and shell state survive disconnects
                            </li>
                            <li>
                                <strong>Visual Status Indicators</strong> - Shield icons show status
                            </li>
                            <li>
                                <strong>Flexible Configuration</strong> - Enable globally, per-connection, or
                                per-terminal
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-network-wired"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        Enhanced Connection Monitoring
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Connection Keepalives</strong> - Active monitoring with keepalive probes
                            </li>
                            <li>
                                <strong>Stalled Connection Detection</strong> - Visual feedback for network issues
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-window-maximize"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        Workspace Interaction Updates
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>Improved auto-scrolling behavior in active panes</li>
                            <li>More consistent panel controls during long-running operations</li>
                            <li>Better image-heavy workflow handling</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Terminal Improvements</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Enhanced Context Menu</strong> - Quick access to splits, themes, and more
                            </li>
                            <li>
                                <strong>OSC 52 Clipboard Support</strong> - CLI apps can copy to system clipboard
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_0_Content.displayName = "UpgradeOnboardingModal_v0_14_0_Content";

export { UpgradeOnboardingModal_v0_14_0_Content };
