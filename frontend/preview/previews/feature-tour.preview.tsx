// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { FeatureTourCard } from "@/app/onboarding/feature-tour";
import { FeatureTourSteps } from "@/app/onboarding/feature-tour-model";
import { useState } from "react";

export function FeatureTourPreview() {
    const [index, setIndex] = useState(0);
    const [opened, setOpened] = useState(false);
    const [closed, setClosed] = useState(false);
    const [error, setError] = useState("");
    return (
        <div className="w-full p-3 pt-8">
            <button
                className="cursor-pointer mb-4"
                onClick={() => {
                    setClosed(false);
                    setIndex(0);
                    setOpened(false);
                }}
            >
                Restart feature tour
            </button>
            {closed ? (
                <p>Tour closed</p>
            ) : (
                <FeatureTourCard
                    step={FeatureTourSteps[index]}
                    opened={opened}
                    busy={false}
                    error={error}
                    onOpen={() => setOpened(true)}
                    onClose={() => setClosed(true)}
                    onMove={(delta) => {
                        if (index + delta === FeatureTourSteps.length) {
                            setClosed(true);
                            return;
                        }
                        setIndex(index + delta);
                        setOpened(false);
                        setError("");
                    }}
                />
            )}
            <button
                className="cursor-pointer mt-4 block"
                onClick={() => setError("Run a command in a supported shell first, then inspect its output.")}
            >
                Show unavailable output
            </button>
        </div>
    );
}
