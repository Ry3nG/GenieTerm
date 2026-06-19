// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_12_1_Content = () => {
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">
                    Patch release focused on shell integration improvements, terminal context tracking, and restoring
                    syntax highlighting in code editor blocks.
                </p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        Shell Integration & Context
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>OSC 7 Support</strong> - GenieTerm now automatically tracks and restores your
                                current directory across restarts for bash, zsh, fish, and pwsh shells
                            </li>
                            <li>
                                <strong>Shell Context Tracking</strong> - Tracks when your shell is ready, last command
                                executed, and exit codes for better terminal management
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-code"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Editor Improvements</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>Restored syntax highlighting in code editor preview blocks</li>
                            <li>Improved editor header button spacing</li>
                            <li>
                                Terminal state metadata now tracks current directory, command history, and exit codes
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-wrench"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Other Changes</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>Mobile user agent emulation support for web widgets</li>
                            <li>Improved terminal restart behavior</li>
                            <li>General stability fixes</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_12_1_Content.displayName = "UpgradeOnboardingModal_v0_12_1_Content";

export { UpgradeOnboardingModal_v0_12_1_Content };
