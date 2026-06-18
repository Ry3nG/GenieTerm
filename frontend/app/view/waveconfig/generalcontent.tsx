// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AppTheme, normalizeAppTheme } from "@/app/app-theme";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo } from "react";

type AppThemeOption = {
    icon: string;
    label: string;
    selected: boolean;
    theme: AppTheme;
};

const AppThemeOptions: Array<Omit<AppThemeOption, "selected">> = [
    { theme: "dark", label: "Dark", icon: "moon" },
    { theme: "light", label: "Light", icon: "sun" },
];

export function makeAppThemeOptions(currentTheme: unknown): AppThemeOption[] {
    const normalizedTheme = normalizeAppTheme(currentTheme);
    return AppThemeOptions.map((option) => ({
        ...option,
        selected: option.theme === normalizedTheme,
    }));
}

export function updateSettingsJsonTheme(content: string, theme: AppTheme): string {
    try {
        const parsed = content.trim() === "" ? {} : JSON.parse(content);
        if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
            return content;
        }
        parsed["app:theme"] = theme;
        return JSON.stringify(parsed, null, 2);
    } catch {
        return content;
    }
}

const GeneralSettingsContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const currentAppTheme = useAtomValue(model.env.getSettingsKeyAtom("app:theme"));
    const selectedTheme = normalizeAppTheme(currentAppTheme);
    const themeOptions = makeAppThemeOptions(currentAppTheme);

    const handleThemeChange = (theme: AppTheme) => {
        if (theme === selectedTheme) {
            return;
        }
        fireAndForget(async () => {
            try {
                await model.env.rpc.SetConfigCommand(TabRpcClient, { "app:theme": theme });
                const nextContent = updateSettingsJsonTheme(globalStore.get(model.fileContentAtom), theme);
                globalStore.set(model.fileContentAtom, nextContent);
                globalStore.set(model.originalContentAtom, nextContent);
                globalStore.set(model.hasEditedAtom, false);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                globalStore.set(model.errorMessageAtom, `Failed to save theme: ${message}`);
            }
        });
    };

    return (
        <div className="h-full overflow-y-auto bg-background text-primary">
            <div className="max-w-3xl p-6">
                <div className="text-xl font-semibold">General</div>
                <div className="mt-6 border border-border bg-panel rounded-lg">
                    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                        <div className="text-sm font-semibold">Appearance</div>
                        <div
                            role="radiogroup"
                            aria-label="Theme"
                            className="grid grid-cols-2 gap-1 rounded-full border border-border bg-hover p-1"
                        >
                            {themeOptions.map((option) => (
                                <button
                                    key={option.theme}
                                    type="button"
                                    role="radio"
                                    aria-checked={option.selected}
                                    className={cn(
                                        "min-w-24 rounded-full px-4 py-2 text-sm transition-colors cursor-pointer flex items-center justify-center gap-2",
                                        option.selected
                                            ? "bg-accent text-[#fff]"
                                            : "text-secondary hover:bg-hoverbg hover:text-primary"
                                    )}
                                    onClick={() => handleThemeChange(option.theme)}
                                >
                                    <i className={`fa fa-solid fa-${option.icon}`} />
                                    <span>{option.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

GeneralSettingsContent.displayName = "GeneralSettingsContent";

export { GeneralSettingsContent };
