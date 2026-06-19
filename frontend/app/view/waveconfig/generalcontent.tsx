// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AppTheme, normalizeAppTheme } from "@/app/app-theme";
import { normalizeAppIconVariant, type AppIconVariant } from "@/app/app-icon";
import iconBlackUrl from "@/app/asset/genieterm-logo-black.png";
import iconDefaultUrl from "@/app/asset/genieterm-logo.png";
import iconWhiteUrl from "@/app/asset/genieterm-logo-white.png";
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

type AppIconOption = {
    icon: AppIconVariant;
    label: string;
    preview: string;
    selected: boolean;
};

const AppThemeOptions: Array<Omit<AppThemeOption, "selected">> = [{ theme: "dark", label: "Dark", icon: "moon" }];

const AppIconOptions: Array<Omit<AppIconOption, "selected">> = [
    { icon: "default", label: "Default", preview: iconDefaultUrl },
    { icon: "black", label: "Black", preview: iconBlackUrl },
    { icon: "white", label: "White", preview: iconWhiteUrl },
];

export function makeAppThemeOptions(currentTheme: unknown): AppThemeOption[] {
    const normalizedTheme = normalizeAppTheme(currentTheme);
    return AppThemeOptions.map((option) => ({
        ...option,
        selected: option.theme === normalizedTheme,
    }));
}

export function makeAppIconOptions(currentIcon: unknown): AppIconOption[] {
    const normalizedIcon = normalizeAppIconVariant(currentIcon);
    return AppIconOptions.map((option) => ({
        ...option,
        selected: option.icon === normalizedIcon,
    }));
}

function updateSettingsJsonValue(content: string, key: string, value: string): string {
    try {
        const parsed = content.trim() === "" ? {} : JSON.parse(content);
        if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
            return content;
        }
        parsed[key] = value;
        return JSON.stringify(parsed, null, 2);
    } catch {
        return content;
    }
}

export function updateSettingsJsonTheme(content: string, theme: AppTheme): string {
    return updateSettingsJsonValue(content, "app:theme", theme);
}

export function updateSettingsJsonAppIcon(content: string, icon: AppIconVariant): string {
    return updateSettingsJsonValue(content, "app:icon", icon);
}

const GeneralSettingsContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const currentAppIcon = useAtomValue(model.env.getSettingsKeyAtom("app:icon"));
    const selectedIcon = normalizeAppIconVariant(currentAppIcon);
    const iconOptions = makeAppIconOptions(currentAppIcon);

    const handleIconChange = (icon: AppIconVariant) => {
        if (icon === selectedIcon) {
            return;
        }
        fireAndForget(async () => {
            try {
                await model.env.rpc.SetConfigCommand(TabRpcClient, { "app:icon": icon });
                model.env.electron.setAppIconVariant(icon);
                const nextContent = updateSettingsJsonAppIcon(globalStore.get(model.fileContentAtom), icon);
                globalStore.set(model.fileContentAtom, nextContent);
                globalStore.set(model.originalContentAtom, nextContent);
                globalStore.set(model.hasEditedAtom, false);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                globalStore.set(model.errorMessageAtom, `Failed to save app icon: ${message}`);
            }
        });
    };

    return (
        <div className="h-full overflow-y-auto bg-background text-primary">
            <div className="max-w-3xl p-6">
                <div className="text-xl font-semibold">General</div>
                <div className="mt-6 border border-border bg-panel rounded-lg">
                    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                        <div className="text-sm font-semibold">App Icon</div>
                        <div
                            role="radiogroup"
                            aria-label="App Icon"
                            className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-hover p-1"
                        >
                            {iconOptions.map((option) => (
                                <button
                                    key={option.icon}
                                    type="button"
                                    role="radio"
                                    aria-checked={option.selected}
                                    className={cn(
                                        "min-w-24 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer flex items-center justify-center gap-2",
                                        option.selected
                                            ? "bg-accent text-[#fff]"
                                            : "text-secondary hover:bg-hoverbg hover:text-primary"
                                    )}
                                    onClick={() => handleIconChange(option.icon)}
                                >
                                    <img
                                        src={option.preview}
                                        alt=""
                                        className="h-7 w-7 shrink-0 rounded-md border border-border object-cover"
                                        draggable={false}
                                    />
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
