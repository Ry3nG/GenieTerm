// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";

export class WaveAiModel implements ViewModel {
    viewType = "waveai";
    viewIcon = atom("sparkles");
    viewName = atom("GenieTerm AI");
    noPadding = atom(true);
    viewComponent = WaveAiDeprecatedView;

    constructor(_: ViewModelInitType) {}
}

function WaveAiDeprecatedView() {
    return (
        <div className="flex h-full w-full flex-col px-6 text-center">
            <div className="flex-[4]" />
            <div className="mx-auto flex w-full max-w-[760px] flex-col items-center">
                <h2 className="text-xl font-semibold text-primary">
                    This legacy GenieTerm AI block is no longer supported
                </h2>
                <p className="mt-3 text-sm leading-6 text-secondary">
                    This older chat widget has been retired. Use the inline command AI from a terminal prompt to turn
                    natural language into shell commands.
                </p>
            </div>
            <div className="flex-[6]" />
        </div>
    );
}
