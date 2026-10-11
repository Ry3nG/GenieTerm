// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { normalizeAppIconVariant, type AppIconVariant } from "@/app/app-icon";
import { AppTheme, normalizeAppTheme } from "@/app/app-theme";
import iconBlackUrl from "@/app/asset/genieterm-logo-black.png";
import iconWhiteUrl from "@/app/asset/genieterm-logo-white.png";
import iconDefaultUrl from "@/app/asset/genieterm-logo.png";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { useAtomValue } from "jotai";
import { memo, useId, useState } from "react";
import { getNotifyAfterOption, NotifyAfterOptions } from "./notifyafter";
import {
    SettingsNumber,
    SettingsRow,
    SettingsSection,
    SettingsSegmented,
    SettingsText,
    SettingsToggle,
    type SettingsOption,
} from "./settingscontrols";
import type { GeneralSettingKey } from "./waveconfigenv";

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

export type SettingsJsonValue =
    | string
    | number
    | boolean
    | null
    | SettingsJsonValue[]
    | { [key: string]: SettingsJsonValue };

export function updateSettingsJsonValue(content: string, key: string, value: SettingsJsonValue): string {
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

type SettingDefinition = {
    key: GeneralSettingKey;
    label: string;
    description: string;
} & (
    | { kind: "toggle" }
    | { kind: "number"; min: number; max: number; step?: number; fallback: number }
    | { kind: "text"; placeholder: string }
    | { kind: "segmented"; options: SettingsOption[]; fallback: string }
    | { kind: "notifyafter" }
);

const AppearanceSettings: SettingDefinition[] = [
    {
        key: "term:fontsize",
        label: "Terminal font size",
        description: "Size of terminal text in pixels.",
        kind: "number",
        min: 4,
        max: 64,
        step: 0.5,
        fallback: 12,
    },
    {
        key: "term:fontfamily",
        label: "Terminal font family",
        description: "Use any locally installed monospace font.",
        kind: "text",
        placeholder: "Hack (default)",
    },
    {
        key: "term:cursor",
        label: "Cursor style",
        description: "The shape of the terminal cursor.",
        kind: "segmented",
        fallback: "block",
        options: [
            { value: "block", label: "Block" },
            { value: "bar", label: "Bar" },
            { value: "underline", label: "Underline" },
        ],
    },
    {
        key: "term:cursorblink",
        label: "Blinking cursor",
        description: "Blink the cursor while the terminal is focused.",
        kind: "toggle",
    },
    {
        key: "app:tabbar",
        label: "Tab bar position",
        description: "Place workspace tabs along the top or left edge.",
        kind: "segmented",
        fallback: "top",
        options: [
            { value: "top", label: "Top" },
            { value: "left", label: "Left" },
        ],
    },
];

const TerminalSettings: SettingDefinition[] = [
    {
        key: "term:presentation",
        label: "Command presentation",
        description: "Semantic shows each command as a block. Classic is the plain terminal grid.",
        kind: "segmented",
        fallback: "semantic",
        options: [
            { value: "semantic", label: "Semantic" },
            { value: "classic", label: "Classic" },
        ],
    },
    {
        key: "term:notifyafter",
        label: "Notify when long commands finish",
        description: "When a command runs longer than this and you are not looking at it.",
        kind: "notifyafter",
    },
    {
        key: "term:copyonselect",
        label: "Copy on select",
        description: "Copy selected terminal text to the clipboard.",
        kind: "toggle",
    },
    {
        key: "app:rightclickpaste",
        label: "Right-click paste",
        description: "Paste from the clipboard with a right-click.",
        kind: "toggle",
    },
    {
        key: "term:bellindicator",
        label: "Bell indicator",
        description: "Show an indicator when a terminal rings its bell.",
        kind: "toggle",
    },
    {
        key: "term:bellsound",
        label: "Bell sound",
        description: "Play a sound when a terminal rings its bell.",
        kind: "toggle",
    },
    {
        key: "term:scrollback",
        label: "Scrollback lines",
        description: "Lines of history each terminal keeps, up to 50,000.",
        kind: "number",
        min: 1,
        max: 50000,
        fallback: 2000,
    },
];

const SessionSettings: SettingDefinition[] = [
    {
        key: "term:durable",
        label: "Durable SSH sessions",
        description: "New SSH terminals keep running on the host through sleep and network drops.",
        kind: "toggle",
    },
    {
        key: "term:forwardoffer",
        label: "Offer to open remote servers",
        description: "When a server in an SSH terminal prints a localhost URL, offer to forward it and open it here.",
        kind: "toggle",
    },
    {
        key: "conn:wshenabled",
        label: "Install the genie helper on hosts",
        description: "Needed for durable sessions and genie commands. Files fall back to SFTP without it.",
        kind: "toggle",
    },
    {
        key: "conn:askbeforewshinstall",
        label: "Ask before installing",
        description: "Ask the first time GenieTerm installs the helper on a host.",
        kind: "toggle",
    },
];

const WindowSettings: SettingDefinition[] = [
    {
        key: "app:confirmquit",
        label: "Confirm before quitting",
        description: "Ask before quitting GenieTerm.",
        kind: "toggle",
    },
    {
        key: "window:confirmclose",
        label: "Confirm before closing",
        description: "Ask before closing a window.",
        kind: "toggle",
    },
    {
        key: "window:savelastwindow",
        label: "Reopen last window",
        description: "Restore your last window when GenieTerm launches.",
        kind: "toggle",
    },
    {
        key: "window:tilegapsize",
        label: "Tile gap",
        description: "Space between tiles in pixels.",
        kind: "number",
        min: 0,
        max: 32,
        fallback: 3,
    },
];

const UpdateSettings: SettingDefinition[] = [
    {
        key: "autoupdate:enabled",
        label: "Automatic updates",
        description: "Check for and download new versions automatically.",
        kind: "toggle",
    },
    {
        key: "autoupdate:installonquit",
        label: "Install on quit",
        description: "Install downloaded updates when you quit GenieTerm.",
        kind: "toggle",
    },
];

function useSettingCommit(model: WaveConfigViewModel, key: GeneralSettingKey) {
    const [busy, setBusy] = useState(false);
    const onCommit = async (value: string | boolean | number) => {
        setBusy(true);
        try {
            return await model.saveGeneralSetting(key, value);
        } finally {
            setBusy(false);
        }
    };
    return { busy, onCommit };
}

function GeneralSettingRow({ model, setting }: { model: WaveConfigViewModel; setting: SettingDefinition }) {
    const value = useAtomValue(model.env.getSettingsKeyAtom(setting.key));
    const id = useId();
    const { busy, onCommit } = useSettingCommit(model, setting.key);
    let control;
    switch (setting.kind) {
        case "notifyafter":
            control = (
                <SettingsSegmented
                    id={id}
                    busy={busy}
                    value={getNotifyAfterOption(value)}
                    onCommit={(option) => onCommit(Number(option))}
                    options={NotifyAfterOptions}
                />
            );
            break;
        case "toggle":
            control = <SettingsToggle id={id} value={Boolean(value)} onCommit={onCommit} busy={busy} />;
            break;
        case "number":
            control = (
                <SettingsNumber
                    id={id}
                    busy={busy}
                    value={typeof value === "number" ? value : setting.fallback}
                    onCommit={onCommit}
                    min={setting.min}
                    max={setting.max}
                    step={setting.step}
                />
            );
            break;
        case "text":
            control = (
                <SettingsText
                    id={id}
                    busy={busy}
                    value={typeof value === "string" ? value : ""}
                    onCommit={onCommit}
                    placeholder={setting.placeholder}
                />
            );
            break;
        case "segmented":
            control = (
                <SettingsSegmented
                    id={id}
                    busy={busy}
                    value={typeof value === "string" ? value : setting.fallback}
                    onCommit={onCommit}
                    options={setting.options}
                />
            );
            break;
    }
    return (
        <SettingsRow id={id} label={setting.label} description={setting.description}>
            {control}
        </SettingsRow>
    );
}

const GeneralSettingsContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const currentAppIcon = useAtomValue(model.env.getSettingsKeyAtom("app:icon"));
    const isSaving = useAtomValue(model.isSavingAtom);
    const iconId = useId();
    const { busy: iconBusy, onCommit: saveIcon } = useSettingCommit(model, "app:icon");
    const version = model.env.electron.getAboutModalDetails()?.version;
    const renderRows = (settings: SettingDefinition[]) =>
        settings.map((setting) => <GeneralSettingRow key={setting.key} model={model} setting={setting} />);

    return (
        <div className="h-full overflow-y-auto bg-background text-primary">
            <fieldset aria-busy={isSaving} className="mx-auto w-full min-w-0 max-w-[768px] space-y-7 p-4 @w600:p-6">
                <div className="px-1">
                    <h1 className="text-xl font-semibold tracking-tight">General</h1>
                    <p className="mt-1 text-sm text-secondary">Changes save automatically.</p>
                </div>
                <SettingsSection
                    title="Appearance"
                    footer="Terminals and connections can override these in their own settings."
                >
                    <SettingsRow
                        id={iconId}
                        label="App icon"
                        description={
                            PLATFORM === PlatformMacOS
                                ? "Choose the icon shown in the Dock."
                                : "Choose the icon shown in the taskbar and window switcher."
                        }
                    >
                        <SettingsSegmented
                            id={iconId}
                            busy={iconBusy}
                            value={normalizeAppIconVariant(currentAppIcon)}
                            options={AppIconOptions.map((option) => ({
                                value: option.icon,
                                label: option.label,
                                image: option.preview,
                            }))}
                            onCommit={saveIcon}
                        />
                    </SettingsRow>
                    {renderRows(AppearanceSettings)}
                </SettingsSection>
                <SettingsSection title="Terminal">{renderRows(TerminalSettings)}</SettingsSection>
                <SettingsSection title="Sessions & connections">{renderRows(SessionSettings)}</SettingsSection>
                <SettingsSection title="Window">{renderRows(WindowSettings)}</SettingsSection>
                <SettingsSection
                    title="Updates"
                    footer={version ? `GenieTerm · Version ${version}` : "GenieTerm · Version unavailable"}
                >
                    {renderRows(UpdateSettings)}
                </SettingsSection>
            </fieldset>
        </div>
    );
});

GeneralSettingsContent.displayName = "GeneralSettingsContent";

export { GeneralSettingsContent };
