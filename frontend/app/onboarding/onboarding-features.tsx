// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientModel } from "@/app/store/client-model";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useEffect, useState } from "react";
import { CurrentOnboardingVersion } from "./onboarding-common";
import { DurableSessionPage } from "./onboarding-durable";
import { HostPage } from "./onboarding-host";
import { FeatureItem, Keys, TourFooter, TourPage, TourWindow } from "./onboarding-tour";

type FeaturePageName = "durable" | "blocks" | "files" | "host";

type DemoBlockTone = "ok" | "error" | "interrupted";

const DemoBlockGutter: Record<DemoBlockTone, string> = {
    ok: "bg-success",
    error: "bg-error",
    interrupted: "bg-warning",
};

const DemoBlockMeta: Record<DemoBlockTone, string> = {
    ok: "text-muted",
    error: "text-error",
    interrupted: "text-warning",
};

function DemoBlock({
    tone,
    command,
    meta,
    output,
}: {
    tone: DemoBlockTone;
    command: string;
    meta: string;
    output: string;
}) {
    return (
        <div className={cn("relative rounded-md py-1.5 pl-3.5 pr-2.5", tone === "error" && "bg-error/10")}>
            <span className={cn("absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full", DemoBlockGutter[tone])} />
            <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 truncate text-foreground">
                    <span className="text-accent">❯</span> {command}
                </div>
                <div className={cn("flex-shrink-0 font-sans text-[11px]", DemoBlockMeta[tone])}>{meta}</div>
            </div>
            <div className="truncate text-secondary">{output}</div>
        </div>
    );
}

function CommandBlocksIllustration() {
    return (
        <TourWindow icon="fa-laptop" title="~/projects/api">
            <div className="flex flex-col gap-2">
                <DemoBlock tone="ok" command="git pull --rebase" meta="0.8s" output="Already up to date." />
                <DemoBlock tone="error" command="npm test" meta="Exit 1 · 4.1s" output="2 failing, 148 passing" />
                <DemoBlock tone="interrupted" command="tail -f logs/app.log" meta="Interrupted" output="^C" />
                <div className="pl-3.5">
                    <span className="text-accent">❯</span>{" "}
                    <span className="inline-block h-[13px] w-[7px] translate-y-[2px] bg-foreground/80" />
                </div>
            </div>
        </TourWindow>
    );
}

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
    const features: FeatureItem[] = [
        {
            icon: "fa-copy",
            title: "One click to copy or re-run",
            description: "Hover a block to copy the command or its output, or run it again.",
        },
        {
            icon: "fa-arrows-up-down",
            title: "Jump between commands",
            description: (
                <>
                    <Keys combo={isMac ? "⇧⌘↑" : "Ctrl+Shift+↑"} /> and <Keys combo={isMac ? "⇧⌘↓" : "Ctrl+Shift+↓"} />{" "}
                    move through long sessions.
                </>
            ),
        },
        {
            icon: "fa-wand-magic-sparkles",
            title: "Describe what you want",
            description: (
                <>
                    <Keys combo={isMac ? "⇧⌘Space" : "Ctrl+Shift+Space"} /> proposes a command. It never runs one for
                    you.
                </>
            ),
        },
    ];
    return (
        <TourPage
            eyebrow="Command Blocks"
            title="Every command, kept together"
            lede="GenieTerm follows your shell's prompts, so each command keeps its status, duration and output in one block. Underneath it is the same terminal you already use."
            features={features}
            illustration={<CommandBlocksIllustration />}
            footer={<TourFooter step={2} total={4} onNext={onNext} onPrev={onPrev} onSkip={onSkip} />}
        />
    );
};

const DemoFiles = [
    { icon: "fa-folder", name: "config", kind: "Folder", size: "—" },
    { icon: "fa-folder", name: "logs", kind: "Folder", size: "—" },
    { icon: "fa-file-code", name: "docker-compose.yml", kind: "YAML", size: "2.1 KB" },
    { icon: "fa-file-lines", name: "README.md", kind: "Markdown", size: "6.4 KB" },
    { icon: "fa-file-zipper", name: "backup.tar.gz", kind: "Archive", size: "1.2 GB" },
];

function FilesIllustration() {
    return (
        <TourWindow icon="fa-folder-open" title="genie://deploy@prod-1/srv/app">
            <div className="flex h-full flex-col font-sans text-[12px]">
                <div className="flex flex-col">
                    {DemoFiles.map((file, idx) => (
                        <div
                            key={file.name}
                            className={cn(
                                "flex items-center gap-2.5 rounded px-2 py-[5px]",
                                idx === 3 && "bg-accent/15 ring-1 ring-inset ring-accent/40"
                            )}
                        >
                            <i
                                className={cn(
                                    "fa-solid w-3.5 text-center text-[11px]",
                                    file.icon,
                                    file.icon === "fa-folder" ? "text-accent" : "text-muted"
                                )}
                                aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 truncate text-foreground">{file.name}</span>
                            <span className="w-16 text-muted">{file.kind}</span>
                            <span className="w-12 text-right tabular-nums text-muted">{file.size}</span>
                        </div>
                    ))}
                </div>
                <div className="mt-auto rounded-lg border border-border bg-hover px-3 py-2">
                    <div className="flex items-center gap-2 text-[11.5px]">
                        <i className="fa-solid fa-arrow-down text-[10px] text-accent" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-foreground">backup.tar.gz</span>
                        <span className="tabular-nums text-muted">740 MB of 1.2 GB</span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/10">
                        <div className="h-full w-[62%] rounded-full bg-accent" />
                    </div>
                </div>
            </div>
        </TourWindow>
    );
}

const FilesFeatures: FeatureItem[] = [
    {
        icon: "fa-eye",
        title: "genie view [filename]",
        description: "Preview Markdown, images, video and code from any shell, local or remote.",
    },
    {
        icon: "fa-pen-to-square",
        title: "genie edit [filename]",
        description: "Edit in a real editor, with atomic saves even over SSH.",
    },
    {
        icon: "fa-arrow-right-arrow-left",
        title: "Drag files in, download folders out",
        description: "Transfers show progress, survive restarts, and can be retried.",
    },
];

export const FilesPage = ({
    onNext,
    onSkip,
    onPrev,
}: {
    onNext: () => void;
    onSkip?: () => void;
    onPrev?: () => void;
}) => {
    return (
        <TourPage
            eyebrow="Files"
            title="Remote files, next to your shell"
            lede="Browse folders on this Mac or any host you're connected to. Preview them, edit them, and move files between them without leaving the workspace."
            features={FilesFeatures}
            illustration={<FilesIllustration />}
            footer={<TourFooter step={3} total={4} onNext={onNext} onPrev={onPrev} onSkip={onSkip} />}
        />
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
    }, []);

    const handleNext = () => {
        if (currentPage === "durable") {
            setCurrentPage("blocks");
        } else if (currentPage === "blocks") {
            setCurrentPage("files");
        } else if (currentPage === "files") {
            setCurrentPage("host");
        }
    };

    const handlePrev = () => {
        if (currentPage === "blocks") {
            setCurrentPage("durable");
        } else if (currentPage === "files") {
            setCurrentPage("blocks");
        } else if (currentPage === "host") {
            setCurrentPage("files");
        }
    };

    let pageComp: React.JSX.Element = null;
    switch (currentPage) {
        case "durable":
            pageComp = <DurableSessionPage onNext={handleNext} onSkip={onComplete} onPrev={handlePrev} />;
            break;
        case "blocks":
            pageComp = <CommandBlocksPage onNext={handleNext} onSkip={onComplete} onPrev={handlePrev} />;
            break;
        case "files":
            pageComp = <FilesPage onNext={handleNext} onSkip={onComplete} onPrev={handlePrev} />;
            break;
        case "host":
            pageComp = <HostPage onFinish={onComplete} onPrev={handlePrev} />;
            break;
    }

    return <div className="flex flex-col w-full h-full">{pageComp}</div>;
};
