// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FeatureItem, TourFooter, TourPage, TourWindow } from "./onboarding-tour";

const DurableFeatures: FeatureItem[] = [
    {
        icon: "fa-shield-halved",
        title: "On for any SSH session",
        description: "Click the shield in a terminal's header, or make it the default in Settings.",
    },
    {
        icon: "fa-rotate",
        title: "Reconnects by itself",
        description: "After sleep or a dropped network, GenieTerm reattaches as soon as the host is reachable.",
    },
    {
        icon: "fa-bars-staggered",
        title: "Nothing goes missing",
        description: "Output written while you were away streams back in order, as if you never left.",
    },
];

function DurableIllustration() {
    return (
        <TourWindow
            icon="fa-arrow-right-arrow-left"
            title="deploy@prod-1"
            badge={<i className="fa-sharp fa-solid fa-shield text-[11px] text-sky-500" aria-label="Durable session" />}
        >
            <div className="flex h-full flex-col text-foreground/85">
                <div>
                    <span className="text-accent">❯</span> ./release.sh v2.4.0
                </div>
                <div className="text-secondary">[1/4] building image</div>
                <div className="text-secondary">[2/4] pushing to registry</div>
                <div className="my-3 flex items-center gap-2 font-sans text-[11px] text-muted">
                    <span className="h-px flex-1 bg-border" />
                    <span className="flex items-center gap-1.5 rounded-full border border-border bg-hover px-2 py-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        Reconnected after 2h 14m
                    </span>
                    <span className="h-px flex-1 bg-border" />
                </div>
                <div className="text-secondary">[3/4] rolling out 12 pods</div>
                <div className="text-secondary">[4/4] health checks passed</div>
                <div className="text-success">released v2.4.0 in 2h 16m</div>
                <div className="mt-1">
                    <span className="text-accent">❯</span>{" "}
                    <span className="inline-block h-[13px] w-[7px] translate-y-[2px] bg-foreground/80" />
                </div>
            </div>
        </TourWindow>
    );
}

export const DurableSessionPage = ({
    onNext,
    onSkip,
    onPrev,
}: {
    onNext: () => void;
    onSkip: () => void;
    onPrev?: () => void;
}) => {
    return (
        <TourPage
            eyebrow="Durable SSH"
            title="Sessions that outlive the connection"
            lede="Close the lid, change networks, or quit GenieTerm. A durable session keeps running on the host and picks up exactly where you left it."
            features={DurableFeatures}
            illustration={<DurableIllustration />}
            footer={<TourFooter step={1} total={4} onNext={onNext} onPrev={onPrev} onSkip={onSkip} />}
        />
    );
};
