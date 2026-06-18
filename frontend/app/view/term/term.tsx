// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import ClaudeColorSvg from "@/app/asset/claude-color.svg";
import { SubBlock } from "@/app/block/block";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import { NullErrorBoundary } from "@/app/element/errorboundary";
import { Search, useSearch } from "@/app/element/search";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { useTabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atoms, getApi, getOverrideConfigAtom, getSettingsKeyAtom, getSettingsPrefixAtom, WOS } from "@/store/global";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import { ISearchOptions } from "@xterm/addon-search";
import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import { useDrop } from "react-dnd";
import {
    formatCmdBlockDuration,
    getCmdBlockStatus,
    getCmdBlockTitle,
} from "./cmdblockdisplay";
import { type CmdBlock, blockHasCommand, getBlockOutputText } from "./cmdblocks";
import { TermCommandComposer } from "./command-composer-ui";
import { formatDraggedFileTerminalPaste } from "./terminal-drop";
import {
    getTerminalPresentationClassName,
    normalizeTerminalPresentationMode,
    type TerminalPresentationMode,
} from "./terminaldisplay";
import { TermLinkTooltip } from "./term-tooltip";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { computeTheme, normalizeCursorStyle } from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

const dlog = debug("wave:term");

interface TerminalViewProps {
    blockId: string;
    model: TermViewModel;
}

const TermClaudeIcon = React.memo(() => {
    return (
        <div className="[&_svg]:w-[15px] [&_svg]:h-[15px]" aria-hidden="true">
            <ClaudeColorSvg />
        </div>
    );
});

TermClaudeIcon.displayName = "TermClaudeIcon";

const TerminalPresentationShell = React.memo(
    ({ presentationMode, children }: { presentationMode: TerminalPresentationMode; children: React.ReactNode }) => {
        return (
            <div
                className={clsx("term-presentation-shell", getTerminalPresentationClassName(presentationMode))}
                data-terminal-presentation={presentationMode}
            >
                {children}
            </div>
        );
    }
);

TerminalPresentationShell.displayName = "TerminalPresentationShell";

function measureTerminalLineHeight(termWrap: TermWrap): number {
    const rowElem = termWrap.terminal.element?.querySelector(".xterm-rows > div") as HTMLElement;
    const rowHeight = rowElem?.getBoundingClientRect().height;
    if (rowHeight > 0) {
        return rowHeight;
    }
    const fontSize = termWrap.terminal.options.fontSize;
    if (typeof fontSize === "number") {
        return Math.max(14, Math.round(fontSize * 1.35));
    }
    return 16;
}

const TermSemanticGutter = React.memo(
    ({ termWrap, presentationMode }: { termWrap: TermWrap | null; presentationMode: TerminalPresentationMode }) => {
        const cmdBlocks = useAtomValueSafe<CmdBlock[]>(termWrap?.cmdBlocksAtom) ?? [];
        const [viewportY, setViewportY] = React.useState(0);
        const [lineHeight, setLineHeight] = React.useState(16);
        const [nowTs, setNowTs] = React.useState(Date.now());

        React.useEffect(() => {
            if (presentationMode !== "semantic" || termWrap?.terminal == null) {
                return;
            }
            const terminal = termWrap.terminal;
            const syncViewport = () => {
                setViewportY(terminal.buffer.active.viewportY);
                setLineHeight(measureTerminalLineHeight(termWrap));
            };
            syncViewport();
            const measureTimer = window.setTimeout(syncViewport, 0);
            const scrollDisposable = terminal.onScroll(syncViewport);
            const resizeDisposable = terminal.onResize(syncViewport);
            return () => {
                window.clearTimeout(measureTimer);
                scrollDisposable.dispose();
                resizeDisposable.dispose();
            };
        }, [presentationMode, termWrap]);

        React.useEffect(() => {
            if (presentationMode !== "semantic" || !cmdBlocks.some((block) => block.state !== "done")) {
                return;
            }
            const intervalId = window.setInterval(() => setNowTs(Date.now()), 1000);
            return () => window.clearInterval(intervalId);
        }, [cmdBlocks, presentationMode]);

        if (presentationMode !== "semantic" || termWrap?.terminal == null) {
            return null;
        }
        const terminal = termWrap.terminal;
        const buffer = terminal.buffer.active;
        if (buffer.type === "alternate") {
            return null;
        }
        const visibleBlocks = cmdBlocks.filter((block) => {
            const line = block.startMarker?.line ?? -1;
            return blockHasCommand(block) && line >= viewportY && line < viewportY + terminal.rows;
        });
        if (visibleBlocks.length === 0) {
            return <div className="term-semantic-gutter" aria-hidden="true" />;
        }

        const jumpToBlock = (block: CmdBlock) => {
            const line = block.startMarker?.line;
            if (line == null || line < 0) {
                return;
            }
            terminal.scrollToLine(line);
        };
        const copyCommand = (block: CmdBlock) => {
            if (!block.command) {
                return;
            }
            navigator.clipboard.writeText(block.command);
        };
        const copyOutput = (block: CmdBlock) => {
            const text = getBlockOutputText(block, terminal);
            if (!text) {
                return;
            }
            navigator.clipboard.writeText(text);
        };

        return (
            <div className="term-semantic-gutter" aria-label="Command blocks">
                {visibleBlocks.map((block) => {
                    const status = getCmdBlockStatus(block);
                    const duration = formatCmdBlockDuration(block, nowTs);
                    const title = getCmdBlockTitle(block, nowTs);
                    const top = (block.startMarker.line - viewportY) * lineHeight;
                    return (
                        <div
                            key={block.id}
                            className={clsx("term-semantic-block", `is-${status.tone}`)}
                            style={{ top }}
                            data-cmdblock-id={block.id}
                        >
                            <button
                                type="button"
                                className="term-semantic-jump cursor-pointer"
                                title={title}
                                aria-label={`Jump to command: ${block.command}`}
                                onClick={() => jumpToBlock(block)}
                            >
                                <i className={status.iconClass} aria-hidden="true" />
                                <span>{duration}</span>
                            </button>
                            <button
                                type="button"
                                className="term-semantic-action cursor-pointer"
                                title="Copy command"
                                aria-label={`Copy command: ${block.command}`}
                                onClick={() => copyCommand(block)}
                            >
                                <i className="fa-solid fa-terminal" aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                className="term-semantic-action cursor-pointer"
                                title="Copy output"
                                aria-label={`Copy output for command: ${block.command}`}
                                onClick={() => copyOutput(block)}
                            >
                                <i className="fa-solid fa-copy" aria-hidden="true" />
                            </button>
                        </div>
                    );
                })}
            </div>
        );
    }
);

TermSemanticGutter.displayName = "TermSemanticGutter";

const TermResyncHandler = React.memo(({ blockId, model }: TerminalViewProps) => {
    const connStatus = jotai.useAtomValue(model.connStatus);
    const [lastConnStatus, setLastConnStatus] = React.useState<ConnStatus>(connStatus);

    React.useEffect(() => {
        if (!model.termRef.current?.hasResized) {
            return;
        }
        const isConnected = connStatus?.status == "connected";
        const wasConnected = lastConnStatus?.status == "connected";
        const curConnName = connStatus?.connection;
        const lastConnName = lastConnStatus?.connection;
        if (isConnected == wasConnected && curConnName == lastConnName) {
            return;
        }
        model.termRef.current?.resyncController("resync handler");
        setLastConnStatus(connStatus);
    }, [connStatus]);

    return null;
});

const TermVDomToolbarNode = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribeSingle({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (_event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomtoolbarblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const vdomNodeModel: BlockNodeModel = React.useMemo(
        () => ({
            blockId: vdomBlockId,
            isFocused: jotai.atom(false),
            isMagnified: jotai.atom(false),
            focusNode: () => {},
            toggleMagnify: () => {},
            onClose: () => {
                if (vdomBlockId != null) {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
                }
            },
        }),
        [vdomBlockId]
    );
    const toolbarTarget = jotai.useAtomValue(model.vdomToolbarTarget);
    const heightStr = toolbarTarget?.height ?? "1.5em";
    return (
        <div key="vdomToolbar" className="term-toolbar" style={{ height: heightStr }}>
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNodeSingleId = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribeSingle({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (_event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const vdomNodeModel: BlockNodeModel = React.useMemo(() => {
        const isFocusedAtom = jotai.atom((get) => {
            return get(model.nodeModel.isFocused) && get(model.termMode) == "vdom";
        });
        return {
            blockId: vdomBlockId,
            isFocused: isFocusedAtom,
            isMagnified: jotai.atom(false),
            focusNode: () => {
                model.nodeModel.focusNode();
            },
            toggleMagnify: () => {},
            onClose: () => {
                if (vdomBlockId != null) {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
                }
            },
        };
    }, [vdomBlockId, model]);
    return (
        <div key="htmlElem" className="term-htmlelem">
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomBlockId = jotai.useAtomValue(model.vdomBlockId);
    if (vdomBlockId == null) {
        return null;
    }
    return <TermVDomNodeSingleId key={vdomBlockId} vdomBlockId={vdomBlockId} blockId={blockId} model={model} />;
};

const TermToolbarVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomToolbarBlockId = jotai.useAtomValue(model.vdomToolbarBlockId);
    if (vdomToolbarBlockId == null) {
        return null;
    }
    return (
        <TermVDomToolbarNode
            key={vdomToolbarBlockId}
            vdomBlockId={vdomToolbarBlockId}
            blockId={blockId}
            model={model}
        />
    );
};

const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [termWrapInst, setTermWrapInst] = React.useState<TermWrap | null>(null);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const connStatus = jotai.useAtomValue(model.connStatus);
    const shellIntegrationStatus = useAtomValueSafe(termWrapInst?.shellIntegrationStatusAtom);
    const lastCommand = useAtomValueSafe(termWrapInst?.lastCommandAtom);
    const termSettingsAtom = getSettingsPrefixAtom("term");
    const termSettings = jotai.useAtomValue(termSettingsAtom);
    const terminalPresentationSetting = jotai.useAtomValue(getOverrideConfigAtom(blockId, "term:presentation"));
    const terminalPresentationMode = normalizeTerminalPresentationMode(terminalPresentationSetting);
    let termMode = blockData?.meta?.["term:mode"] ?? "term";
    if (termMode != "term" && termMode != "vdom") {
        termMode = "term";
    }
    const termModeRef = React.useRef(termMode);

    const tabModel = useTabModel();
    const termFontSize = jotai.useAtomValue(model.fontSizeAtom);
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const connFontFamily = fullConfig.connections?.[blockData?.meta?.connection]?.["term:fontfamily"];
    const isFocused = jotai.useAtomValue(model.nodeModel.isFocused);
    const isMI = jotai.useAtomValue(tabModel.isTermMultiInput);
    const isBasicTerm = termMode != "vdom" && blockData?.meta?.controller != "cmd"; // needs to match isBasicTerm

    // search
    const searchProps = useSearch({
        anchorRef: viewRef,
        viewModel: model,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
    });
    const searchIsOpen = jotai.useAtomValue<boolean>(searchProps.isOpen);
    const caseSensitive = useAtomValueSafe<boolean>(searchProps.caseSensitive);
    const wholeWord = useAtomValueSafe<boolean>(searchProps.wholeWord);
    const regex = useAtomValueSafe<boolean>(searchProps.regex);
    const searchVal = jotai.useAtomValue<string>(searchProps.searchValue);
    const searchDecorations = React.useMemo(
        () => ({
            matchOverviewRuler: "#000000",
            activeMatchColorOverviewRuler: "#000000",
            activeMatchBorder: "#FF9632",
            matchBorder: "#FFFF00",
        }),
        []
    );
    const searchOpts = React.useMemo<ISearchOptions>(
        () => ({
            regex,
            wholeWord,
            caseSensitive,
            decorations: searchDecorations,
        }),
        [regex, wholeWord, caseSensitive]
    );
    const handleSearchError = React.useCallback((e: Error) => {
        console.warn("search error:", e);
    }, []);
    const executeSearch = React.useCallback(
        (searchText: string, direction: "next" | "previous") => {
            if (searchText === "") {
                model.termRef.current?.searchAddon.clearDecorations();
                return;
            }
            try {
                model.termRef.current?.searchAddon[direction === "next" ? "findNext" : "findPrevious"](
                    searchText,
                    searchOpts
                );
            } catch (e) {
                handleSearchError(e);
            }
        },
        [searchOpts, handleSearchError]
    );
    searchProps.onSearch = React.useCallback(
        (searchText: string) => executeSearch(searchText, "previous"),
        [executeSearch]
    );
    searchProps.onPrev = React.useCallback(() => executeSearch(searchVal, "previous"), [executeSearch, searchVal]);
    searchProps.onNext = React.useCallback(() => executeSearch(searchVal, "next"), [executeSearch, searchVal]);
    // Return input focus to the terminal when the search is closed
    React.useEffect(() => {
        if (!searchIsOpen) {
            model.giveFocus();
        }
    }, [searchIsOpen]);
    // rerun search when the searchOpts change
    React.useEffect(() => {
        model.termRef.current?.searchAddon.clearDecorations();
        searchProps.onSearch(searchVal);
    }, [searchOpts]);
    // end search

    React.useEffect(() => {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemeName = globalStore.get(model.termThemeNameAtom);
        const termTransparency = globalStore.get(model.termTransparencyAtom);
        const termMacOptionIsMetaAtom = getOverrideConfigAtom(blockId, "term:macoptionismeta");
        const [termTheme, _] = computeTheme(fullConfig, termThemeName, termTransparency);
        let termScrollback = 2000;
        if (termSettings?.["term:scrollback"]) {
            termScrollback = Math.floor(termSettings["term:scrollback"]);
        }
        if (blockData?.meta?.["term:scrollback"]) {
            termScrollback = Math.floor(blockData.meta["term:scrollback"]);
        }
        if (termScrollback < 0) {
            termScrollback = 0;
        }
        if (termScrollback > 50000) {
            termScrollback = 50000;
        }
        const termAllowBPM = globalStore.get(model.termBPMAtom) ?? true;
        const termMacOptionIsMeta = globalStore.get(termMacOptionIsMetaAtom) ?? false;
        const termCursorStyle = normalizeCursorStyle(globalStore.get(getOverrideConfigAtom(blockId, "term:cursor")));
        const termCursorBlink = globalStore.get(getOverrideConfigAtom(blockId, "term:cursorblink")) ?? false;
        const wasFocused = model.termRef.current != null && globalStore.get(model.nodeModel.isFocused);
        const termWrap = new TermWrap(
            tabModel.tabId,
            blockId,
            connectElemRef.current,
            {
                theme: termTheme,
                fontSize: termFontSize,
                fontFamily: termSettings?.["term:fontfamily"] ?? connFontFamily ?? "Hack",
                drawBoldTextInBrightColors: false,
                fontWeight: "normal",
                fontWeightBold: "bold",
                allowTransparency: true,
                scrollback: termScrollback,
                allowProposedApi: true, // Required by @xterm/addon-search to enable search functionality and decorations
                ignoreBracketedPasteMode: !termAllowBPM,
                macOptionIsMeta: termMacOptionIsMeta,
                cursorStyle: termCursorStyle,
                cursorBlink: termCursorBlink,
                overviewRuler: { width: 6 },
            },
            {
                keydownHandler: model.handleTerminalKeydown.bind(model),
                useWebGl: !termSettings?.["term:disablewebgl"],
                sendDataHandler: model.sendDataToController.bind(model),
                nodeModel: model.nodeModel,
            }
        );
        (window as any).term = termWrap;
        model.termRef.current = termWrap;
        setTermWrapInst(termWrap);
        const rszObs = new ResizeObserver(() => {
            termWrap.handleResize_debounced();
        });
        rszObs.observe(connectElemRef.current);
        termWrap.onSearchResultsDidChange = (results) => {
            globalStore.set(searchProps.resultsIndex, results.resultIndex);
            globalStore.set(searchProps.resultsCount, results.resultCount);
        };
        fireAndForget(termWrap.initTerminal.bind(termWrap));
        if (wasFocused) {
            setTimeout(() => {
                model.giveFocus();
            }, 10);
        }
        return () => {
            termWrap.dispose();
            rszObs.disconnect();
            setTermWrapInst(null);
        };
    }, [blockId, termSettings, termFontSize, connFontFamily]);

    React.useEffect(() => {
        if (termModeRef.current == "vdom" && termMode == "term") {
            // focus the terminal
            model.giveFocus();
        }
        termModeRef.current = termMode;
    }, [termMode]);

    React.useEffect(() => {
        if (isMI && isBasicTerm && isFocused && model.termRef.current != null) {
            model.termRef.current.multiInputCallback = (data: string) => {
                model.multiInputHandler(data);
            };
        } else {
            if (model.termRef.current != null) {
                model.termRef.current.multiInputCallback = null;
            }
        }
    }, [isMI, isBasicTerm, isFocused]);

    const stickerConfig = {
        charWidth: 8,
        charHeight: 16,
        rows: model.termRef.current?.terminal.rows ?? 24,
        cols: model.termRef.current?.terminal.cols ?? 80,
        blockId: blockId,
    };

    const termBg = computeBgStyleFromMeta(blockData?.meta);

    const handleContextMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const rightClickPaste = globalStore.get(getSettingsKeyAtom("app:rightclickpaste"));
            if (rightClickPaste) {
                e.preventDefault();
                e.stopPropagation();
                getApi().nativePaste();
                model.giveFocus();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const menuItems = model.getContextMenuItems();
            ContextMenuModel.getInstance().showContextMenu(menuItems, e);
        },
        [model]
    );

    const handleDraggedFileDrop = React.useCallback(
        (draggedFile: DraggedFile) => {
            const pasteText = formatDraggedFileTerminalPaste(draggedFile, {
                terminalConnection: connStatus?.connection ?? blockData?.meta?.connection ?? "local",
                terminalShellIntegrationStatus: shellIntegrationStatus,
                terminalLastCommand: lastCommand,
            });
            if (!pasteText) {
                return;
            }
            model.termRef.current?.terminal?.paste(pasteText);
            model.giveFocus();
        },
        [blockData?.meta?.connection, connStatus?.connection, lastCommand, model, shellIntegrationStatus]
    );

    const [, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM",
            drop: (draggedFile: DraggedFile, monitor) => {
                if (monitor.didDrop()) {
                    return;
                }
                handleDraggedFileDrop(draggedFile);
            },
        }),
        [handleDraggedFileDrop]
    );

    const viewDropRef = React.useCallback(
        (node: HTMLDivElement | null) => {
            viewRef.current = node;
            drop(node);
        },
        [drop]
    );

    return (
        <div
            className={clsx(
                "view-term",
                "term-mode-" + termMode,
                getTerminalPresentationClassName(terminalPresentationMode)
            )}
            ref={viewDropRef}
            onContextMenu={handleContextMenu}
        >
            {termBg && <div key="term-bg" className="absolute inset-0 z-0 pointer-events-none" style={termBg} />}
            <TermResyncHandler blockId={blockId} model={model} />
            <TermThemeUpdater blockId={blockId} model={model} termRef={model.termRef} />
            <TermStickers config={stickerConfig} />
            <TermToolbarVDomNode key="vdom-toolbar" blockId={blockId} model={model} />
            <TermVDomNode key="vdom" blockId={blockId} model={model} />
            <TerminalPresentationShell presentationMode={terminalPresentationMode}>
                <TermSemanticGutter termWrap={termWrapInst} presentationMode={terminalPresentationMode} />
                <div key="connect-elem" className="term-connectelem" ref={connectElemRef} />
            </TerminalPresentationShell>
            <NullErrorBoundary debugName="TermLinkTooltip">
                <TermLinkTooltip termWrap={termWrapInst} />
            </NullErrorBoundary>
            <TermCommandComposer model={model} blockData={blockData} connStatus={connStatus} termWrap={termWrapInst} />
            <Search {...searchProps} />
        </div>
    );
};

export { TermClaudeIcon, TerminalView };
