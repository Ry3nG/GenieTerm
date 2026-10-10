// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { RunCompletionGenerator } from "./fig-static-provider";
import type { CompletionProvider } from "./types";

export async function hasFigSpec(command: string): Promise<boolean> {
    const { figSpecExists } = await import("./fig-static-provider");
    return figSpecExists(command);
}

export function makeLazyFigCompletionProvider(runGenerator: RunCompletionGenerator): CompletionProvider {
    let provider: Promise<CompletionProvider>;
    return {
        id: "fig",
        priority: 8,
        provideCompletions: async (ctx) => {
            provider ??= import("./fig-static-provider").then(({ makeFigStaticCompletionProvider }) =>
                makeFigStaticCompletionProvider({ runGenerator })
            );
            return (await provider).provideCompletions(ctx);
        },
    };
}
