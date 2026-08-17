// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo";
import { EmojiButton } from "@/app/element/emojibutton";
import { ClientModel } from "@/app/store/client-model";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isMacOS } from "@/util/platformutil";
import { useEffect, useState } from "react";
import { EditBashrcCommand, ViewLogoCommand, ViewShortcutsCommand } from "./onboarding-command";
import { CurrentOnboardingVersion } from "./onboarding-common";
import { DurableSessionPage } from "./onboarding-durable";
import { OnboardingFooter } from "./onboarding-features-footer";
import { FakeTermBlock } from "./onboarding-layout-term";

type FeaturePageName = "durable" | "blocks" | "files";

export const CommandBlocksPage = ({
    onNext,
    onSkip,
    onPrev,
}: {
    onNext: () => void;
    onSkip: () => void;
    onPrev?: () => void;
}) => {
    const isMac = isMacOS();
    const jumpShortcut = isMac ? "⌘⇧↑ / ⌘⇧↓" : "Ctrl-Shift-↑ / Ctrl-Shift-↓";
    const [fireClicked, setFireClicked] = useState(false);

    const handleFireClick = () => {
        setFireClicked(!fireClicked);
        if (!fireClicked) {
            RpcApi.RecordTEventCommand(TabRpcClient, {
                event: "onboarding:fire",
                props: {
                    "onboarding:feature": "blocks",
                    "onboarding:version": CurrentOnboardingVersion,
                },
            });
        }
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">Command Blocks</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="flex flex-col items-start gap-4 text-secondary max-w-md">
                        <p>
                            Each command is a block with status, duration, and its output. Failed commands are visually
                            distinct. This is a presentation layer over the same terminal session — not a second
                            runtime.
                        </p>
                        <div className="flex items-start gap-3 w-full">
                            <i className="fa-solid fa-check text-accent text-lg mt-1 flex-shrink-0" />
                            <p>Copy the command or its output, or re-run it, from the command action bar.</p>
                        </div>
                        <div className="flex items-start gap-3 w-full">
                            <i className="fa-solid fa-arrows-up-down text-accent text-lg mt-1 flex-shrink-0" />
                            <p>
                                Jump between commands with{" "}
                                <span className="font-mono font-semibold text-foreground">{jumpShortcut}</span>.
                            </p>
                        </div>
                        <p>Classic xterm is still in Settings → Command presentation if you want the raw grid.</p>
                        <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={handleFireClick} />
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    <FakeTermBlock connectionName="local" className="h-[280px]">
                        <div className="font-mono text-sm flex flex-col gap-3">
                            <div className="rounded-md border border-border/60 bg-hover/40 px-3 py-2">
                                <div className="text-foreground/80">lsblk</div>
                                <div className="text-xs text-secondary mt-1">OK · 0.2s</div>
                            </div>
                            <div className="rounded-md border border-red-400/40 bg-red-400/10 px-3 py-2">
                                <div className="text-foreground/80">kubectl get pods</div>
                                <div className="text-xs text-red-300 mt-1">Exit 1 · 1.4s</div>
                            </div>
                        </div>
                    </FakeTermBlock>
                </div>
            </div>
            <OnboardingFooter currentStep={2} totalSteps={3} onNext={onNext} onPrev={onPrev} onSkip={onSkip} />
        </div>
    );
};

export const FilesPage = ({ onFinish, onPrev }: { onFinish: () => void; onPrev?: () => void }) => {
    const [fireClicked, setFireClicked] = useState(false);
    const isMac = isMacOS();
    const [commandIndex, setCommandIndex] = useState(0);

    const handleFireClick = () => {
        setFireClicked(!fireClicked);
        if (!fireClicked) {
            RpcApi.RecordTEventCommand(TabRpcClient, {
                event: "onboarding:fire",
                props: {
                    "onboarding:feature": "files",
                    "onboarding:version": CurrentOnboardingVersion,
                },
            });
        }
    };

    const commands = [
        (onComplete: () => void) => <EditBashrcCommand onComplete={onComplete} />,
        (onComplete: () => void) => <ViewShortcutsCommand isMac={isMac} onComplete={onComplete} />,
        (onComplete: () => void) => <ViewLogoCommand onComplete={onComplete} />,
    ];

    const handleCommandComplete = () => {
        setTimeout(() => {
            setCommandIndex((prev) => (prev + 1) % commands.length);
        }, 2500);
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">Viewing/Editing Files</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="flex flex-col items-start gap-6 max-w-md">
                        <div className="flex flex-col items-start gap-4 text-secondary">
                            <p>
                                GenieTerm can preview markdown, images, and video files on both local <i>and remote</i>{" "}
                                machines.
                            </p>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-eye text-accent text-lg mt-1 flex-shrink-0" />
                                <div>
                                    <p className="mb-2">
                                        Use{" "}
                                        <span className="font-mono font-semibold text-foreground">
                                            genie view [filename]
                                        </span>{" "}
                                        to preview files in GenieTerm's graphical viewer
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-pen-to-square text-accent text-lg mt-1 flex-shrink-0" />
                                <div>
                                    <p className="mb-2">
                                        Use{" "}
                                        <span className="font-mono font-semibold text-foreground">
                                            genie edit [filename]
                                        </span>{" "}
                                        to open config files or code files in GenieTerm's graphical editor
                                    </p>
                                </div>
                            </div>

                            <p>
                                These commands work seamlessly on both local and remote machines, making it easy to view
                                and edit files wherever they are.
                            </p>

                            <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={handleFireClick} />
                        </div>
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    {commands[commandIndex](handleCommandComplete)}
                </div>
            </div>
            <OnboardingFooter currentStep={3} totalSteps={3} onNext={onFinish} onPrev={onPrev} />
        </div>
    );
};

export const OnboardingFeatures = ({ onComplete }: { onComplete: () => void }) => {
    const [currentPage, setCurrentPage] = useState<FeaturePageName>("durable");

    useEffect(() => {
        const clientId = ClientModel.getInstance().clientId;
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:lastversion": CurrentOnboardingVersion },
        });
        RpcApi.RecordTEventCommand(TabRpcClient, {
            event: "onboarding:start",
            props: {
                "onboarding:version": CurrentOnboardingVersion,
            },
        });
    }, []);

    const handleNext = () => {
        if (currentPage === "durable") {
            setCurrentPage("blocks");
        } else if (currentPage === "blocks") {
            setCurrentPage("files");
        }
    };

    const handlePrev = () => {
        if (currentPage === "blocks") {
            setCurrentPage("durable");
        } else if (currentPage === "files") {
            setCurrentPage("blocks");
        }
    };

    const handleSkip = () => {
        RpcApi.RecordTEventCommand(TabRpcClient, {
            event: "onboarding:skip",
            props: {},
        });
        onComplete();
    };

    const handleFinish = () => {
        onComplete();
    };

    let pageComp: React.JSX.Element = null;
    switch (currentPage) {
        case "durable":
            pageComp = <DurableSessionPage onNext={handleNext} onSkip={handleSkip} onPrev={handlePrev} />;
            break;
        case "blocks":
            pageComp = <CommandBlocksPage onNext={handleNext} onSkip={handleSkip} onPrev={handlePrev} />;
            break;
        case "files":
            pageComp = <FilesPage onFinish={handleFinish} onPrev={handlePrev} />;
            break;
    }

    return <div className="flex flex-col w-full h-full">{pageComp}</div>;
};
