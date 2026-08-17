// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { modalsModel } from "@/app/store/modalmodel";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { GitPanel } from "./gitpanel";

export type WidgetsEnv = WaveEnvSubset<{
    isDev: WaveEnv["isDev"];
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        hasConfigErrors: WaveEnv["atoms"]["hasConfigErrors"];
        workspaceId: WaveEnv["atoms"]["workspaceId"];
    };
    createBlock: WaveEnv["createBlock"];
    showContextMenu: WaveEnv["showContextMenu"];
}>;

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType }): WidgetConfigType[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.values(wmap);
    wlist.sort((a, b) => {
        return (a["display:order"] ?? 0) - (b["display:order"] ?? 0);
    });
    return wlist;
}

type WidgetPropsType = {
    widget: WidgetConfigType;
    mode: "normal" | "compact" | "supercompact";
    env: WidgetsEnv;
};

type WidgetSettingsActionItem = {
    icon: string;
    label: string;
    hasError?: boolean;
    onClick: () => void;
};

type WidgetSettingsActionOptions = {
    hasConfigErrors: boolean;
    onOpenSettings: () => void;
};

type BuiltinToolButtonProps = {
    icon: string;
    label: string;
    tooltip: string;
    mode: WidgetPropsType["mode"];
    active?: boolean;
    onClick: () => void;
};

function makeWidgetSettingsActionItems({
    hasConfigErrors,
    onOpenSettings,
}: WidgetSettingsActionOptions): WidgetSettingsActionItem[] {
    return [
        {
            icon: "gear",
            label: "Settings",
            hasError: hasConfigErrors,
            onClick: () => {
                onOpenSettings();
            },
        },
    ];
}

async function handleWidgetSelect(widget: WidgetConfigType, env: WidgetsEnv) {
    const blockDef = widget.blockdef;
    env.createBlock(blockDef, widget.magnified);
}

const Widget = memo(({ widget, mode, env }: WidgetPropsType) => {
    const [isTruncated, setIsTruncated] = useState(false);
    const labelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (mode === "normal" && labelRef.current) {
            const element = labelRef.current;
            setIsTruncated(element.scrollWidth > element.clientWidth);
        }
    }, [mode, widget.label]);

    const shouldDisableTooltip = mode !== "normal" ? false : !isTruncated;

    return (
        <Tooltip
            content={widget.description || widget.label}
            placement="left"
            disable={shouldDisableTooltip}
            divClassName={clsx(
                "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                mode === "supercompact" ? "text-sm" : "text-lg",
                widget["display:hidden"] && "hidden"
            )}
            divOnClick={() => handleWidgetSelect(widget, env)}
        >
            <div style={{ color: widget.color }}>
                <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
            </div>
            {mode === "normal" && !isBlank(widget.label) ? (
                <div
                    ref={labelRef}
                    className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis"
                >
                    {widget.label}
                </div>
            ) : null}
        </Tooltip>
    );
});

function SettingsTooltipContent({ item }: { item: WidgetSettingsActionItem }) {
    if (!item.hasError) {
        return item.label;
    }
    return (
        <div className="flex flex-col p-1">
            <div className="mb-1">{item.label}</div>
            <div className="flex items-center gap-1 mt-0.5 text-error">
                <i className="fa fa-solid fa-circle-exclamation"></i>
                <span>Config Errors</span>
            </div>
        </div>
    );
}

function WidgetSettingsButton({ item, mode }: { item: WidgetSettingsActionItem; mode: WidgetPropsType["mode"] }) {
    const isNormal = mode === "normal";
    return (
        <div
            className={clsx(
                "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                mode === "supercompact" ? "text-sm" : "text-lg"
            )}
            onClick={item.onClick}
        >
            <Tooltip content={<SettingsTooltipContent item={item} />} placement="left">
                <div className="flex flex-col items-center w-full">
                    <div className="relative">
                        <i className={makeIconClass(item.icon, true)}></i>
                        {item.hasError && (
                            <i
                                className={clsx(
                                    "fa fa-solid fa-circle-exclamation text-error absolute pointer-events-none",
                                    mode === "supercompact"
                                        ? "top-0 right-0 text-[10px]"
                                        : "top-0 right-[-4px] text-[12px]",
                                    isNormal && "text-[14px]"
                                )}
                            ></i>
                        )}
                    </div>
                    {isNormal && (
                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                            {item.label.toLowerCase()}
                        </div>
                    )}
                </div>
            </Tooltip>
        </div>
    );
}

function BuiltinToolButton({ icon, label, tooltip, mode, active, onClick }: BuiltinToolButtonProps) {
    const isNormal = mode === "normal";
    return (
        <div
            className={clsx(
                "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                active && "bg-hoverbg text-white",
                mode === "supercompact" ? "text-sm" : "text-lg"
            )}
            onClick={onClick}
        >
            <Tooltip content={tooltip} placement="left">
                <div className="flex flex-col items-center w-full">
                    <div>
                        <i className={makeIconClass(icon, true)}></i>
                    </div>
                    {isNormal && (
                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                            {label}
                        </div>
                    )}
                </div>
            </Tooltip>
        </div>
    );
}

const Widgets = memo(() => {
    const env = useWaveEnv<WidgetsEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const hasConfigErrors = useAtomValue(env.atoms.hasConfigErrors);
    const workspaceId = useAtomValue(env.atoms.workspaceId);
    const [mode, setMode] = useState<"normal" | "compact" | "supercompact">("normal");
    const containerRef = useRef<HTMLDivElement>(null);
    const measurementRef = useRef<HTMLDivElement>(null);

    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = Object.fromEntries(
        Object.entries(widgetsMap).filter(([_key, widget]) => shouldIncludeWidgetForWorkspace(widget, workspaceId))
    );
    const widgets = sortByDisplayOrder(filteredWidgets);

    const [activeTool, setActiveTool] = useState<"git" | null>(null);

    const openSettings = useCallback(() => {
        modalsModel.pushModal("SettingsModal");
    }, []);
    const settingsActionItems = makeWidgetSettingsActionItems({
        hasConfigErrors,
        onOpenSettings: openSettings,
    });

    const checkModeNeeded = useCallback(() => {
        if (!containerRef.current || !measurementRef.current) return;

        const containerHeight = containerRef.current.clientHeight;
        const normalHeight = measurementRef.current.scrollHeight;
        const gracePeriod = 10;

        let newMode: "normal" | "compact" | "supercompact" = "normal";

        if (normalHeight > containerHeight - gracePeriod) {
            newMode = "compact";

            // Calculate total widget count for supercompact check
            const totalWidgets = (widgets?.length || 0) + 2;
            const minHeightPerWidget = 32;
            const requiredHeight = totalWidgets * minHeightPerWidget;

            if (requiredHeight > containerHeight) {
                newMode = "supercompact";
            }
        }

        if (newMode !== mode) {
            setMode(newMode);
        }
    }, [mode, widgets]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            checkModeNeeded();
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [checkModeNeeded]);

    useEffect(() => {
        checkModeNeeded();
    }, [widgets, checkModeNeeded]);

    const handleWidgetsBarContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menu: ContextMenuItem[] = [
            {
                label: "Edit widgets.json",
                click: () => {
                    fireAndForget(async () => {
                        const blockDef: BlockDef = {
                            meta: {
                                view: "waveconfig",
                                file: "widgets.json",
                            },
                        };
                        await env.createBlock(blockDef, false, true);
                    });
                },
            },
        ];
        env.showContextMenu(menu, e);
    };

    return (
        <>
            <GitPanel open={activeTool === "git"} onClose={() => setActiveTool(null)} />
            <div
                ref={containerRef}
                className="flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none shrink-0"
                onContextMenu={handleWidgetsBarContextMenu}
            >
                {mode === "supercompact" ? (
                    <>
                        <div className="grid grid-cols-2 gap-0 w-full">
                            <BuiltinToolButton
                                icon="code-branch"
                                label="git"
                                tooltip="Source Control"
                                mode={mode}
                                active={activeTool === "git"}
                                onClick={() => setActiveTool((tool) => (tool === "git" ? null : "git"))}
                            />
                            {widgets?.map((data, idx) => (
                                <Widget key={`widget-${idx}`} widget={data} mode={mode} env={env} />
                            ))}
                        </div>
                        <div className="flex-grow" />
                        <div className="grid grid-cols-2 gap-0 w-full">
                            {settingsActionItems.map((item) => (
                                <WidgetSettingsButton key={item.label} item={item} mode={mode} />
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <BuiltinToolButton
                            icon="code-branch"
                            label="git"
                            tooltip="Source Control"
                            mode={mode}
                            active={activeTool === "git"}
                            onClick={() => setActiveTool((tool) => (tool === "git" ? null : "git"))}
                        />
                        {widgets?.map((data, idx) => (
                            <Widget key={`widget-${idx}`} widget={data} mode={mode} env={env} />
                        ))}
                        <div className="flex-grow" />
                        {settingsActionItems.map((item) => (
                            <WidgetSettingsButton key={item.label} item={item} mode={mode} />
                        ))}
                    </>
                )}
                {env.isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running GenieTerm Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
            <div
                ref={measurementRef}
                className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
            >
                <BuiltinToolButton
                    icon="code-branch"
                    label="git"
                    tooltip="Source Control"
                    mode="normal"
                    active={false}
                    onClick={() => {}}
                />
                {widgets?.map((data, idx) => (
                    <Widget key={`measurement-widget-${idx}`} widget={data} mode="normal" env={env} />
                ))}
                <div className="flex-grow" />
                {settingsActionItems.map((item) => (
                    <WidgetSettingsButton key={`measurement-${item.label}`} item={item} mode="normal" />
                ))}
                {env.isDev() ? (
                    <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                        <div>
                            <i className={makeIconClass("cube", true)}></i>
                        </div>
                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center">apps</div>
                    </div>
                ) : null}
                {env.isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running GenieTerm Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
        </>
    );
});

export { makeWidgetSettingsActionItems, Widgets };
