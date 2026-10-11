// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { setBadge } from "@/app/store/badge";
import { getLocalHomeDir } from "@/app/store/localhome";
import { getTabModelByTabId } from "@/app/store/tab-model";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    fetchWaveFile,
    getApi,
    getBlockMetaKeyAtom,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    isDev,
    openLink,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, base64ToString, fireAndForget } from "@/util/util";
import { FitAddon } from "@xterm/addon-fit";
import type { ISearchOptions, SearchAddon } from "@xterm/addon-search";
import type { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";
import { getCmdBlockStatus, getCommandRunBlockedReason } from "./cmdblockdisplay";
import {
    blockHasCommand,
    findCmdBlockAtLine,
    hashTerminalSnapshot,
    makeCmdBlockDecorationSpecs,
    makeCmdBlockIndexSnapshot,
    parseCmdBlockIndexSnapshot,
    type CmdBlock,
    type CmdBlockIndexSnapshot,
} from "./cmdblocks";
import { formatCommandNotification, shouldNotifyCommandDone } from "./cmdnotify";
import {
    getInlineAICommandPrompt,
    shouldAutoComposeInlineAI,
    type CommandInlineAIRequestHandler,
} from "./command-composer";
import { applyPromptInputData, emptyPromptInputBuffer, isTypeaheadInput } from "./completion/input-mirror";
import { normalizeShellType, type ShellType, type TermInputBuffer } from "./completion/types";
import {
    handleOsc16162Command,
    handleOsc52Command,
    handleOsc7Command,
    isClaudeCodeCommand,
    type ShellIntegrationStatus,
} from "./osc-handlers";
import { makeTermLinkHandlers } from "./term-links";
import { TerminalStreamBoundaryTracker } from "./terminal-stream-boundary";
import {
    bufferLinesToText,
    canUseTerminalCache,
    createTempFileFromBlob,
    extractAllClipboardData,
    normalizeCursorStyle,
    quoteForPosixShell,
    takeAppendBatch,
    trimTerminalSelection,
} from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
export const SupportsImageInput = true;
const MaxRepaintTransactionMs = 2000;

// detect webgl support
function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("webgl2");
        ctx?.getExtension("WEBGL_lose_context")?.loseContext();
        return !!ctx;
    } catch (e) {
        return false;
    }
}

export const WebGLSupported = detectWebGLSupport();
let loggedWebGL = false;
const WebGLTerminals = new Set<TermWrap>();
const WebGLContextBudget = 12;

// The shell reports the prompt cursor as a character (code-point) offset; convert
// it to a JS string index (UTF-16 code units) so multibyte input maps correctly.
function charOffsetToStringIndex(text: string, charOffset: number): number {
    if (charOffset <= 0) {
        return 0;
    }
    let cp = 0;
    let idx = 0;
    for (const ch of text) {
        if (cp >= charOffset) {
            break;
        }
        idx += ch.length;
        cp++;
    }
    return idx;
}

type TermWrapOptions = {
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    sendDataHandler?: (data: string) => void;
    onInlineAIRequest?: CommandInlineAIRequestHandler;
    onInlineAIDismiss?: () => void;
    nodeModel?: BlockNodeModel;
};

export class TermWrap {
    tabId: string;
    blockId: string;
    ptyOffset: number;
    dataBytesProcessed: number;
    terminal: Terminal;
    connectElem: HTMLDivElement;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
    serializeAddon: SerializeAddon;
    searchAddonLoad: Promise<SearchAddon>;
    serializeAddonLoad: Promise<void>;
    searchRequest = 0;
    mainFileSubject: SubjectWithRef<WSFileEventData> | null;
    loaded: boolean;
    heldData: { data: Uint8Array; offset: number; fileEpoch: number }[];
    appendQueue: Promise<void> = Promise.resolve();
    pendingAppends: { data: Uint8Array; offset: number; epoch: number }[] = [];
    appendDrainScheduled = false;
    fileEpoch = 0;
    termFileEpoch = 0;
    cacheRevision = 0;
    disposed = false;
    cacheTimer: number | null = null;
    cacheIdleCallback: number | null = null;
    cacheSaveQueue: Promise<void> = Promise.resolve();
    replayingTerminalData = false;
    streamBoundary = new TerminalStreamBoundaryTracker();
    handleResize_debounced: () => void;
    hasResized: boolean;
    multiInputCallback: (data: string) => void;
    sendDataHandler: (data: string) => void;
    onInlineAIRequest?: CommandInlineAIRequestHandler;
    onInlineAIDismiss?: () => void;
    onSearchResultsDidChange?: (result: { resultIndex: number; resultCount: number }) => void;
    toDispose: TermTypes.IDisposable[] = [];
    webglAddon: WebglAddon | null = null;
    paneActive = true;
    pendingResize = false;
    preferredRenderer: "webgl" | "dom" = "dom";
    webglReleaseTimer: ReturnType<typeof setTimeout> = null;
    webglContextLossDisposable: TermTypes.IDisposable | null = null;
    webglEnabledAtom: jotai.PrimitiveAtom<boolean>;
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    outputMarkers: TermTypes.IMarker[] = [];
    cmdBlocks: CmdBlock[] = [];
    cmdBlocksAtom: jotai.PrimitiveAtom<CmdBlock[]>;
    altScreenActiveAtom: jotai.PrimitiveAtom<boolean>;
    localCompletionInputBuffer: TermInputBuffer;
    localCompletionInputDisabled = false;
    inputSentWhileRunning = false;
    drainingHeldData = false;
    cmdBlocksCacheDirty = false;
    shellInputReportSeen = false;
    currentInputBufferAtom: jotai.PrimitiveAtom<TermInputBuffer | null>;
    pendingCmdBlock: CmdBlock | null = null;
    cmdBlockIdCounter = 0;
    lastCommandNotificationMs: number = null;
    notifyAfterAtom: jotai.Atom<number>;
    publishCmdBlocks: () => void;
    // Warp-style command-block chrome: one xterm decoration per finished command,
    // drawn behind the live text (no extraction, no double-render).
    cmdDecorations = new Map<
        number,
        { decoration: TermTypes.IDecoration; marker: TermTypes.IMarker; cols: number; rows: number; tone: string }
    >();
    syncCmdDecorations_debounced: () => void;
    semanticBlocksEnabled = false;
    hoveredBlockIdAtom: jotai.PrimitiveAtom<number | null>;
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
    shellIntegrationDisabledAtom: jotai.PrimitiveAtom<boolean>;
    shellTypeAtom: jotai.PrimitiveAtom<ShellType>;
    lastCommandAtom: jotai.PrimitiveAtom<string | null>;
    claudeCodeActiveAtom: jotai.PrimitiveAtom<boolean>;
    nodeModel: BlockNodeModel; // this can be null
    hoveredLinkUri: string | null = null;
    onLinkHover?: (uri: string | null, mouseX: number, mouseY: number, showUrl: boolean) => void;

    // Paste deduplication
    // xterm.js paste() method triggers onData event, which can cause duplicate sends
    lastPasteData: string = "";
    lastPasteTime: number = 0;

    // dev only (for debugging)
    recentWrites: { idx: number; data: string; ts: number }[] = [];
    recentWritesCounter: number = 0;

    // for repaint transaction scrolling behavior
    lastClearScrollbackTs: number = 0;
    lastMode2026SetTs: number = 0;
    lastMode2026ResetTs: number = 0;
    inSyncTransaction: boolean = false;
    inRepaintTransaction: boolean = false;

    constructor(
        tabId: string,
        blockId: string,
        connectElem: HTMLDivElement,
        options: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions,
        waveOptions: TermWrapOptions
    ) {
        this.loaded = false;
        this.tabId = tabId;
        this.blockId = blockId;
        this.notifyAfterAtom = getOverrideConfigAtom(blockId, "term:notifyafter");
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.onInlineAIRequest = waveOptions.onInlineAIRequest;
        this.onInlineAIDismiss = waveOptions.onInlineAIDismiss;
        this.nodeModel = waveOptions.nodeModel;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.cmdBlocksAtom = jotai.atom([]) as jotai.PrimitiveAtom<CmdBlock[]>;
        this.hoveredBlockIdAtom = jotai.atom(null) as jotai.PrimitiveAtom<number | null>;
        this.altScreenActiveAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
        this.shellIntegrationDisabledAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.shellTypeAtom = jotai.atom("unknown") as jotai.PrimitiveAtom<ShellType>;
        this.lastCommandAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.claudeCodeActiveAtom = jotai.atom(false);
        this.localCompletionInputBuffer = emptyPromptInputBuffer();
        this.currentInputBufferAtom = jotai.atom(null) as jotai.PrimitiveAtom<TermInputBuffer | null>;
        this.webglEnabledAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        // OSC 8 hyperlinks go through the same modifier-click handler as detected URLs; xterm's
        // default handler confirms and then never opens them
        const linkHandlers = makeTermLinkHandlers(
            PLATFORM === PlatformMacOS,
            (uri) => fireAndForget(() => openLink(uri)),
            (uri, x, y, showUrl) => {
                this.hoveredLinkUri = uri;
                this.onLinkHover?.(uri, x, y, showUrl);
            }
        );
        this.terminal = new Terminal({
            ...options,
            linkHandler: {
                activate: linkHandlers.activate,
                hover: linkHandlers.osc8Hover,
                leave: linkHandlers.leave,
            },
        });
        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(
            new WebLinksAddon(linkHandlers.activate, { hover: linkHandlers.hover, leave: linkHandlers.leave })
        );
        this.setTermRenderer(WebGLSupported && waveOptions.useWebGl ? "webgl" : "dom");
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            try {
                return handleOsc7Command(data, this.blockId, this.isProcessingLiveData());
            } catch (e) {
                console.error("[termwrap] osc 7 handler error", this.blockId, e);
                return false;
            }
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            try {
                return handleOsc52Command(data, this.blockId, this.isProcessingLiveData(), this);
            } catch (e) {
                console.error("[termwrap] osc 52 handler error", this.blockId, e);
                return false;
            }
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            try {
                return handleOsc16162Command(data, this.blockId, this.isProcessingLiveData(), this);
            } catch (e) {
                console.error("[termwrap] osc 16162 handler error", this.blockId, e);
                return false;
            }
        });
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ final: "J" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 3) {
                    this.lastClearScrollbackTs = Date.now();
                    if (this.inSyncTransaction) {
                        console.log("[termwrap] repaint transaction starting");
                        this.inRepaintTransaction = true;
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 2026) {
                    this.lastMode2026SetTs = Date.now();
                    this.inSyncTransaction = true;
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 2026) {
                    this.lastMode2026ResetTs = Date.now();
                    this.inSyncTransaction = false;
                    const wasRepaint = this.inRepaintTransaction;
                    this.inRepaintTransaction = false;
                    if (wasRepaint && Date.now() - this.lastClearScrollbackTs <= MaxRepaintTransactionMs) {
                        setTimeout(() => {
                            console.log("[termwrap] repaint transaction complete, scrolling to bottom");
                            this.terminal.scrollToBottom();
                        }, 20);
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.onBell(() => {
                if (!this.loaded) {
                    return true;
                }
                console.log("BEL received in terminal", this.blockId);
                const bellSoundEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellsound")) ?? false;
                if (bellSoundEnabled) {
                    fireAndForget(() => RpcApi.ElectronSystemBellCommand(TabRpcClient, { route: "electron" }));
                }
                const bellIndicatorEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellindicator")) ?? false;
                if (bellIndicatorEnabled) {
                    setBadge(this.blockId, { icon: "bell", color: "#fbbf24", priority: 1 });
                }
                return true;
            })
        );
        this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            if (!waveOptions.keydownHandler) {
                return true;
            }
            return waveOptions.keydownHandler(e);
        });
        this.connectElem = connectElem;
        this.mainFileSubject = null;
        this.heldData = [];
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
        this.publishCmdBlocks = debounce(16, () => {
            globalStore.set(this.cmdBlocksAtom, [...this.cmdBlocks]);
        });
        this.syncCmdDecorations_debounced = debounce(50, this.syncCmdDecorations.bind(this));
        this.terminal.open(this.connectElem);
        // Track alt-screen (TUIs like vim/htop) so the block view can pass through to a
        // full terminal instead of trying to blockify a full-screen app.
        this.terminal.buffer.onBufferChange(() => {
            globalStore.set(this.altScreenActiveAtom, this.terminal.buffer.active.type === "alternate");
            this.scheduleCmdDecorationSync();
        });

        const dragoverHandler = (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
        };
        const dropHandler = (e: DragEvent) => {
            e.preventDefault();
            if (!e.dataTransfer || e.dataTransfer.files.length === 0) {
                return;
            }
            const paths: string[] = [];
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                const file = e.dataTransfer.files[i];
                const filePath = getApi().getPathForFile(file);
                if (filePath) {
                    paths.push(quoteForPosixShell(filePath));
                }
            }
            if (paths.length > 0) {
                this.terminal.paste(paths.join(" ") + " ");
            }
        };
        this.connectElem.addEventListener("dragover", dragoverHandler);
        this.connectElem.addEventListener("drop", dropHandler);
        const mouseMoveHandler = (e: MouseEvent) => {
            this.updateHoveredBlockFromMouse(e);
        };
        const mouseLeaveHandler = () => {
            globalStore.set(this.hoveredBlockIdAtom, null);
        };
        this.connectElem.addEventListener("mousemove", mouseMoveHandler);
        this.connectElem.addEventListener("mouseleave", mouseLeaveHandler);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("dragover", dragoverHandler);
                this.connectElem.removeEventListener("drop", dropHandler);
                this.connectElem.removeEventListener("mousemove", mouseMoveHandler);
                this.connectElem.removeEventListener("mouseleave", mouseLeaveHandler);
            },
        });
        this.handleResize();
        const pasteHandler = this.pasteHandler.bind(this);
        this.connectElem.addEventListener("paste", pasteHandler, true);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
    }

    getZoneId(): string {
        return this.blockId;
    }

    setCursorStyle(cursorStyle: string) {
        this.terminal.options.cursorStyle = normalizeCursorStyle(cursorStyle);
    }

    setCursorBlink(cursorBlink: boolean) {
        this.terminal.options.cursorBlink = cursorBlink ?? false;
    }

    setFontOptions(fontSize: number, fontFamily: string) {
        const options = this.terminal.options;
        if (options.fontSize === fontSize && options.fontFamily === fontFamily) {
            return;
        }
        options.fontSize = fontSize;
        options.fontFamily = fontFamily;
        // cell size changed, so rows/cols (and the PTY size) must be refit
        this.handleResize();
    }

    setScrollback(scrollback: number) {
        if (this.terminal.options.scrollback === scrollback) {
            return;
        }
        this.terminal.options.scrollback = scrollback;
    }

    setPaneActive(active: boolean) {
        if (this.disposed || this.paneActive === active) {
            return;
        }
        this.paneActive = active;
        clearTimeout(this.webglReleaseTimer);
        if (!active) {
            this.webglReleaseTimer = setTimeout(() => this.releaseWebGL(), 10000);
            return;
        }
        this.setTermRenderer(this.preferredRenderer);
        if (this.pendingResize) {
            this.pendingResize = false;
            this.handleResize();
        }
        this.terminal.refresh(0, this.terminal.rows - 1);
    }

    releaseWebGL() {
        this.webglContextLossDisposable?.dispose();
        this.webglContextLossDisposable = null;
        if (this.webglAddon == null) {
            return;
        }
        // The addon removes its canvas on disposal without releasing the GPU context.
        const canvases = this.terminal.element?.querySelectorAll<HTMLCanvasElement>(".xterm-screen canvas") ?? [];
        const contexts = Array.from(canvases)
            .map((canvas) => canvas.getContext("webgl2"))
            .filter((context) => context != null);
        this.webglAddon.dispose();
        this.webglAddon = null;
        WebGLTerminals.delete(this);
        for (const context of contexts) {
            context.getExtension("WEBGL_lose_context")?.loseContext();
        }
        globalStore.set(this.webglEnabledAtom, false);
    }

    setTermRenderer(renderer: "webgl" | "dom") {
        this.preferredRenderer = renderer;
        if (this.disposed || (!this.paneActive && renderer === "webgl")) {
            return;
        }
        if (renderer === "webgl") {
            if (this.webglAddon != null) {
                return;
            }
            if (!WebGLSupported) {
                renderer = "dom";
            }
        } else {
            if (this.webglAddon == null) {
                return;
            }
        }
        if (this.webglAddon != null) {
            this.releaseWebGL();
        }
        if (renderer === "webgl") {
            // Chromium otherwise force-loses the oldest context, which can belong to a visible terminal.
            for (const term of WebGLTerminals) {
                if (WebGLTerminals.size < WebGLContextBudget) {
                    break;
                }
                if (!term.paneActive || term.connectElem.closest("[inert]") != null) {
                    term.releaseWebGL();
                }
            }
            const addon = new WebglAddon();
            this.webglContextLossDisposable = addon.onContextLoss(() => {
                this.setTermRenderer("dom");
            });
            this.terminal.loadAddon(addon);
            this.webglAddon = addon;
            WebGLTerminals.add(this);
            globalStore.set(this.webglEnabledAtom, true);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        }
    }

    getTermRenderer(): "webgl" | "dom" {
        return this.webglAddon != null ? "webgl" : "dom";
    }

    isWebGlEnabled(): boolean {
        return this.webglAddon != null;
    }

    async initTerminal() {
        const copyOnSelectAtom = getSettingsKeyAtom("term:copyonselect");
        const trimTrailingWhitespaceAtom = getSettingsKeyAtom("term:trimtrailingwhitespace");
        this.toDispose.push(this.terminal.onData(this.handleTermData.bind(this)));
        this.toDispose.push(
            this.terminal.onSelectionChange(
                debounce(50, () => {
                    if (!globalStore.get(copyOnSelectAtom)) {
                        return;
                    }
                    // Don't copy-on-select when the search bar has focus - navigating
                    // search results changes the terminal selection programmatically.
                    const active = document.activeElement;
                    if (active != null && active.closest(".search-container") != null) {
                        return;
                    }
                    let selectedText = this.terminal.getSelection();
                    if (selectedText.length > 0) {
                        if (globalStore.get(trimTrailingWhitespaceAtom) !== false) {
                            selectedText = trimTerminalSelection(selectedText);
                        }
                        navigator.clipboard.writeText(selectedText);
                    }
                })
            )
        );

        this.mainFileSubject = getFileSubject(this.getZoneId(), TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        try {
            const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
            });
            let shellState: ShellIntegrationStatus = null;

            if (rtInfo && rtInfo["shell:integration"]) {
                shellState = rtInfo["shell:state"] as ShellIntegrationStatus;
                globalStore.set(this.shellIntegrationStatusAtom, shellState || null);
                globalStore.set(this.shellTypeAtom, normalizeShellType(rtInfo["shell:type"] as string));
                globalStore.set(this.shellIntegrationDisabledAtom, false);
            } else {
                const integrationDisabled = rtInfo?.["shell:integration"] === false;
                globalStore.set(this.shellIntegrationStatusAtom, null);
                globalStore.set(
                    this.shellTypeAtom,
                    integrationDisabled ? normalizeShellType(rtInfo["shell:type"] as string) : "unknown"
                );
                globalStore.set(this.shellIntegrationDisabledAtom, integrationDisabled);
            }

            const lastCmd = rtInfo ? rtInfo["shell:lastcmd"] : null;
            const isCC = shellState === "running-command" && isClaudeCodeCommand(lastCmd);
            globalStore.set(this.lastCommandAtom, lastCmd || null);
            globalStore.set(this.claudeCodeActiveAtom, isCC);
        } catch (e) {
            console.log("Error loading runtime info:", e);
        }

        try {
            do {
                const epoch = this.fileEpoch;
                await this.loadInitialTerminalData();
                if (epoch !== this.fileEpoch) {
                    this.terminal.clear();
                    this.ptyOffset = 0;
                    this.streamBoundary.reset();
                    continue;
                }
                await this.drainHeldData(epoch);
                if (epoch === this.fileEpoch) {
                    this.loaded = true;
                    this.publishCmdBlocks();
                    this.scheduleCmdDecorationSync();
                }
            } while (!this.loaded && !this.disposed);
        } finally {
            this.loaded = !this.disposed;
        }
        if (!this.disposed) {
            this.runProcessIdleTimeout();
        }
    }

    // Data that arrives while the initial load runs is held and drained afterwards. It is
    // new output (not a replay of history), so shell-integration markers in it must be
    // processed as live even though the terminal isn't marked loaded yet.
    isProcessingLiveData(): boolean {
        return this.loaded || this.drainingHeldData;
    }

    async drainHeldData(epoch: number): Promise<void> {
        this.drainingHeldData = true;
        try {
            while (this.heldData.length > 0 && epoch === this.fileEpoch && !this.disposed) {
                if (this.heldData[0].fileEpoch !== this.termFileEpoch) {
                    this.heldData.shift();
                    continue;
                }
                const batch = takeAppendBatch(this.heldData, (first, next) => next.fileEpoch === first.fileEpoch);
                await this.applyFileAppend(batch.data, batch.offset, epoch);
            }
        } finally {
            this.drainingHeldData = false;
        }
    }

    dispose() {
        clearTimeout(this.webglReleaseTimer);
        this.releaseWebGL();
        this.disposed = true;
        this.loaded = false;
        if (this.cacheTimer != null) {
            window.clearTimeout(this.cacheTimer);
            this.cacheTimer = null;
        }
        if (this.cacheIdleCallback != null) {
            window.cancelIdleCallback(this.cacheIdleCallback);
            this.cacheIdleCallback = null;
        }
        this.promptMarkers.forEach((marker) => {
            try {
                marker.dispose();
            } catch (_) {
                /* nothing */
            }
        });
        this.promptMarkers = [];
        this.outputMarkers.forEach((marker) => marker.dispose());
        this.outputMarkers = [];
        this.cmdBlocks = [];
        this.pendingCmdBlock = null;
        this.disposeCmdDecorations();
        this.webglContextLossDisposable?.dispose();
        this.webglContextLossDisposable = null;
        this.terminal.dispose();
        this.toDispose.forEach((d) => {
            try {
                d.dispose();
            } catch (_) {
                /* nothing */
            }
        });
        this.mainFileSubject?.release();
        this.mainFileSubject = null;
    }

    disposeCmdDecorations() {
        for (const { decoration } of this.cmdDecorations.values()) {
            try {
                decoration.dispose();
            } catch (_) {
                /* nothing */
            }
        }
        this.cmdDecorations.clear();
    }

    handleTermData(data: string) {
        if (!this.loaded) {
            return;
        }

        if (data) {
            this.onInlineAIDismiss?.();
        }
        this.handleLocalCompletionInputData(data);
        this.sendDataHandler?.(data);
        this.multiInputCallback?.(data);
    }

    handleProgrammaticInputData(data: string) {
        this.handleLocalCompletionInputData(data);
    }

    getRunBlockedReason(command: string): string | null {
        return getCommandRunBlockedReason(command, {
            shellIntegrationStatus: globalStore.get(this.shellIntegrationStatusAtom),
            altScreenActive: globalStore.get(this.altScreenActiveAtom),
        });
    }

    hasBracketedPaste(): boolean {
        return this.terminal?.modes?.bracketedPasteMode === true && !this.terminal.options.ignoreBracketedPasteMode;
    }

    // ctrl-e ctrl-u drops whatever is already typed at the prompt (works in the default
    // emacs keymaps of bash, zsh and fish).
    private makePromptLineData(command: string): string {
        if (this.hasBracketedPaste() && /[\r\n]/.test(command)) {
            return `\x05\x15\x1b[200~${command}\x1b[201~`;
        }
        return "\x05\x15" + command;
    }

    // Types a command at the idle prompt and submits it, through the same path as user
    // keystrokes so the input mirror and multi-input see it too.
    runCommand(command: string): boolean {
        if (!this.loaded || this.getRunBlockedReason(command) != null) {
            return false;
        }
        this.terminal.focus();
        this.handleTermData(this.makePromptLineData(command) + "\r");
        return true;
    }

    // Replaces the prompt line with a command without running it. Without shell
    // integration the prompt line can't be cleared safely, so the command is pasted at
    // the cursor instead.
    insertCommand(command: string): boolean {
        if (!this.loaded || !command) {
            return false;
        }
        const shellState = globalStore.get(this.shellIntegrationStatusAtom);
        if (globalStore.get(this.altScreenActiveAtom) || shellState === "running-command") {
            return false;
        }
        if (/[\r\n]/.test(command) && !this.hasBracketedPaste()) {
            return false;
        }
        this.terminal.focus();
        if (shellState !== "ready") {
            this.terminal.paste(command);
            return true;
        }
        this.handleTermData(this.makePromptLineData(command));
        return true;
    }

    makePromptMarker(): TermTypes.IMarker | null {
        const marker = this.terminal.registerMarker(0);
        if (marker == null) {
            return null;
        }
        this.promptMarkers.push(marker);
        marker.onDispose(() => {
            const idx = this.promptMarkers.indexOf(marker);
            if (idx !== -1) {
                this.promptMarkers.splice(idx, 1);
            }
            this.handleCmdBlockMarkerDisposed(marker);
        });
        return marker;
    }

    // xterm's clear() disposes every marker, including the one anchoring the block for
    // the prompt the user is typing at; without re-anchoring, its command would be lost.
    clearTerminal() {
        const pending = this.pendingCmdBlock;
        this.terminal.clear();
        if (pending == null || this.pendingCmdBlock === pending) {
            return;
        }
        const marker = this.makePromptMarker();
        if (marker == null) {
            return;
        }
        pending.startMarker = marker;
        pending.outputMarker = null;
        pending.endMarker = null;
        this.pendingCmdBlock = pending;
        this.cmdBlocks.push(pending);
        this.publishCmdBlocks();
        this.scheduleCmdDecorationSync();
    }

    handleLocalCompletionInputData(data: string) {
        if (!data) {
            return;
        }
        const shellIntegrationStatus = globalStore.get(this.shellIntegrationStatusAtom);
        const altScreenActive = globalStore.get(this.altScreenActiveAtom);
        if (shellIntegrationStatus === "running-command" && !altScreenActive && isTypeaheadInput(data)) {
            this.inputSentWhileRunning = true;
        }
        if (this.shellInputReportSeen || this.localCompletionInputDisabled) {
            return;
        }
        if (shellIntegrationStatus !== "ready" || altScreenActive) {
            return;
        }
        const next = applyPromptInputData(this.localCompletionInputBuffer, data);
        if (next == null) {
            this.localCompletionInputDisabled = true;
            globalStore.set(this.currentInputBufferAtom, null);
            return;
        }
        this.localCompletionInputBuffer = next;
        globalStore.set(this.currentInputBufferAtom, next);
    }

    addFocusListener(focusFn: () => void) {
        this.terminal.textarea.addEventListener("focus", focusFn);
    }

    handleNewFileSubjectData(msg: WSFileEventData) {
        if (msg.fileop == "truncate") {
            this.fileEpoch++;
            this.termFileEpoch = msg.fileepoch || this.termFileEpoch + 1;
            this.terminal.clear();
            this.heldData = [];
            this.pendingAppends = [];
            this.ptyOffset = 0;
            this.streamBoundary.reset();
            this.resetCmdBlocks();
        } else if (msg.fileop == "append") {
            const decodedData = base64ToArray(msg.data64);
            // appends published before a truncate can arrive after it; they belong to the
            // old file contents. termFileEpoch isn't known until the initial load finishes,
            // so held appends are filtered when they are drained.
            const appendEpoch = Number(msg.fileepoch ?? 0);
            if (this.loaded) {
                if (appendEpoch !== this.termFileEpoch) {
                    return;
                }
                this.queueLiveAppend(decodedData, msg.offset);
            } else {
                this.heldData.push({ data: decodedData, offset: msg.offset, fileEpoch: appendEpoch });
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    queueLiveAppend(data: Uint8Array, offset: number) {
        this.pendingAppends.push({ data, offset, epoch: this.fileEpoch });
        if (this.appendDrainScheduled) {
            return;
        }
        this.appendDrainScheduled = true;
        this.appendQueue = this.appendQueue
            .then(() => this.drainPendingAppends())
            .catch((error) => console.error("Terminal append failed", error));
    }

    // Appends that arrive while a write is in flight wait here and are merged into the next write.
    async drainPendingAppends(): Promise<void> {
        try {
            while (this.pendingAppends.length > 0 && !this.disposed) {
                const epoch = this.pendingAppends[0].epoch;
                const batch = takeAppendBatch(this.pendingAppends, (first, next) => next.epoch === first.epoch);
                await this.applyFileAppend(batch.data, batch.offset, epoch);
            }
        } finally {
            this.appendDrainScheduled = false;
        }
    }

    async applyFileAppend(data: Uint8Array, offset: number, epoch: number): Promise<void> {
        if (this.disposed || epoch !== this.fileEpoch) {
            return;
        }
        if (offset > this.ptyOffset) {
            const { data: missing, fileInfo } = await fetchWaveFile(this.getZoneId(), TermFileName, this.ptyOffset);
            if (this.disposed || epoch !== this.fileEpoch) {
                return;
            }
            if (missing?.length && fileInfo != null) {
                await this.doTerminalWrite(missing, fileInfo.size, true, true);
            }
        }
        const overlap = Math.max(0, this.ptyOffset - offset);
        if (overlap >= data.length || this.disposed || epoch !== this.fileEpoch) {
            return;
        }
        await this.doTerminalWrite(data.slice(overlap), offset + data.length, true, true);
    }

    doTerminalWrite(
        data: string | Uint8Array,
        setPtyOffset?: number,
        countForCache = false,
        trackRawBoundary = false
    ): Promise<void> {
        if (isDev() && this.loaded) {
            const dataStr = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
            this.recentWrites.push({ idx: this.recentWritesCounter++, ts: Date.now(), data: dataStr });
            if (this.recentWrites.length > 50) {
                this.recentWrites.shift();
            }
        }
        let resolve: () => void = null;
        const prtn = new Promise<void>((presolve, _) => {
            resolve = presolve;
        });
        this.terminal.write(data, () => {
            if (trackRawBoundary && data instanceof Uint8Array) {
                this.streamBoundary.feed(data);
            }
            if (setPtyOffset != null) {
                this.ptyOffset = setPtyOffset;
                if (countForCache) {
                    this.dataBytesProcessed += data.length;
                }
            } else {
                this.ptyOffset += data.length;
                this.dataBytesProcessed += data.length;
            }
            this.lastUpdated = Date.now();
            resolve();
        });
        return prtn;
    }

    async loadInitialTerminalData(): Promise<void> {
        const startTs = Date.now();
        const zoneId = this.getZoneId();
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(zoneId, TermCacheFileName);
        let ptyOffset = Number(cacheFile?.meta?.["ptyoffset"] ?? 0);
        let { data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, ptyOffset);
        let termFileEpoch = Number(mainFile?.meta?.["fileepoch"] ?? 0);
        this.termFileEpoch = termFileEpoch;
        const fileTermSize: TermSize = cacheFile?.meta?.["termsize"];
        let useCache = canUseTerminalCache({
            cacheFile,
            cacheByteLength: cacheData?.byteLength ?? 0,
            ptyOffset,
            mainFile,
            termFileEpoch,
        });
        let snapshot: CmdBlockIndexSnapshot | null = null;
        if (useCache && cacheFile.meta?.["statehash"] != null) {
            const rawIndex = cacheFile.meta["commandindex"];
            const revision = Number(cacheFile.meta["revision"]);
            snapshot = parseCmdBlockIndexSnapshot(
                rawIndex,
                ptyOffset,
                fileTermSize?.cols,
                this.terminal.options.scrollback
            );
            if (snapshot == null || typeof rawIndex !== "string" || !Number.isSafeInteger(revision)) {
                useCache = false;
            } else {
                const hash = await hashTerminalSnapshot(
                    new TextDecoder().decode(cacheData),
                    ptyOffset,
                    fileTermSize,
                    rawIndex,
                    termFileEpoch,
                    revision
                );
                useCache = hash === cacheFile.meta["statehash"];
            }
        }
        if (useCache) {
            useCache = await this.restoreTerminalCache(cacheData, ptyOffset, fileTermSize, snapshot);
            if (!useCache) {
                this.terminal.reset();
            }
        }
        if (!useCache) {
            ptyOffset = 0;
            ({ data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, 0));
            termFileEpoch = Number(mainFile?.meta?.["fileepoch"] ?? 0);
            this.termFileEpoch = termFileEpoch;
        }
        console.log(
            `terminal loaded cachefile:${useCache ? cacheData.byteLength : 0} main:${mainData?.byteLength ?? 0} bytes, ${Date.now() - startTs}ms`
        );
        if (mainFile != null) {
            this.replayingTerminalData = true;
            try {
                await this.doTerminalWrite(mainData, mainFile.size, false, true);
            } finally {
                this.replayingTerminalData = false;
            }
        }
    }

    // Returns false when the restored buffer doesn't line up with the saved command index;
    // the caller then discards the cache and replays the raw stream instead.
    async restoreTerminalCache(
        cacheData: Uint8Array,
        ptyOffset: number,
        fileTermSize: TermSize,
        snapshot: CmdBlockIndexSnapshot | null
    ): Promise<boolean> {
        const curTermSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        const didResize =
            fileTermSize != null && (fileTermSize.rows !== curTermSize.rows || fileTermSize.cols !== curTermSize.cols);
        if (didResize) {
            this.terminal.resize(fileTermSize.cols, fileTermSize.rows);
        }
        await this.doTerminalWrite(cacheData, ptyOffset);
        const snapshotMatches = snapshot == null || this.terminal.buffer.active.length === snapshot.bufferlength;
        if (snapshotMatches && snapshot != null) {
            this.restoreCmdBlockMarkers(snapshot);
        }
        if (didResize) {
            this.terminal.resize(curTermSize.cols, curTermSize.rows);
        }
        return snapshotMatches;
    }

    restoreCmdBlockMarkers(snapshot: CmdBlockIndexSnapshot): void {
        const buffer = this.terminal.buffer.active;
        const cursorLine = buffer.baseY + buffer.cursorY;
        const markers = new Map<number, TermTypes.IMarker>();
        const makeMarker = (line: number): TermTypes.IMarker | null => {
            if (line < 0 || line >= buffer.length) {
                return null;
            }
            const existing = markers.get(line);
            if (existing != null) {
                return existing;
            }
            const marker = this.terminal.registerMarker(line - cursorLine);
            if (marker != null) {
                markers.set(line, marker);
                this.promptMarkers.push(marker);
                marker.onDispose(() => {
                    const index = this.promptMarkers.indexOf(marker);
                    if (index !== -1) {
                        this.promptMarkers.splice(index, 1);
                    }
                    this.handleCmdBlockMarkerDisposed(marker);
                });
            }
            return marker;
        };
        for (const saved of snapshot.blocks) {
            const startMarker = makeMarker(saved.startline);
            if (startMarker == null) {
                continue;
            }
            const endMarker = saved.endline == null ? null : makeMarker(saved.endline);
            const block: CmdBlock = {
                id: saved.id,
                startMarker,
                outputMarker: saved.outputline == null ? null : makeMarker(saved.outputline),
                endMarker,
                command: saved.command,
                exitCode: saved.exitcode,
                state: saved.state,
                interrupted: saved.interrupted === true,
                startTs: saved.startts,
                doneTs: saved.donets,
                cwd: saved.cwd,
            };
            this.cmdBlocks.push(block);
            this.cmdBlockIdCounter = Math.max(this.cmdBlockIdCounter, block.id);
            if (block.state === "running") {
                this.pendingCmdBlock = block;
            }
        }
        this.publishCmdBlocks();
        this.scheduleCmdDecorationSync();
    }

    async resyncController(reason: string) {
        dlog("resync controller", this.blockId, reason);
        const rtOpts: RuntimeOpts = { termsize: { rows: this.terminal.rows, cols: this.terminal.cols } };
        try {
            await RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: this.tabId,
                blockid: this.blockId,
                rtopts: rtOpts,
            });
        } catch (e) {
            console.log(`error controller resync (${reason})`, this.blockId, e);
        }
    }

    handleResize() {
        if (!this.paneActive) {
            this.pendingResize = true;
            return;
        }
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        this.fitAddon.fit();
        if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            console.log(
                "[termwrap] resize",
                `${oldRows}x${oldCols}`,
                "->",
                `${this.terminal.rows}x${this.terminal.cols}`
            );
            RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize });
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
        // reflow changed the cols/row geometry the cards are sized to - re-anchor them.
        this.scheduleCmdDecorationSync();
    }

    clearSearch() {
        this.searchRequest++;
        this.searchAddon?.clearDecorations();
    }

    async search(text: string, direction: "next" | "previous", options: ISearchOptions) {
        const request = ++this.searchRequest;
        if (text === "") {
            this.searchAddon?.clearDecorations();
            return;
        }
        if (this.searchAddon == null) {
            this.searchAddonLoad ??= import("@xterm/addon-search")
                .then(({ SearchAddon }) => {
                    if (this.disposed) {
                        return null;
                    }
                    const addon = new SearchAddon();
                    this.terminal.loadAddon(addon);
                    this.toDispose.push(addon.onDidChangeResults((result) => this.onSearchResultsDidChange?.(result)));
                    this.searchAddon = addon;
                    return addon;
                })
                .catch((error) => {
                    this.searchAddonLoad = null;
                    throw error;
                });
            await this.searchAddonLoad;
        }
        if (this.disposed || request !== this.searchRequest) {
            return;
        }
        this.searchAddon[direction === "next" ? "findNext" : "findPrevious"](text, options);
    }

    processAndCacheData() {
        if (
            this.disposed ||
            this.inSyncTransaction ||
            this.terminal.buffer.active.type !== "normal" ||
            !this.streamBoundary.isSafe ||
            (this.dataBytesProcessed < MinDataProcessedForCache && !this.cmdBlocksCacheDirty)
        ) {
            return;
        }
        if (this.serializeAddon == null) {
            this.serializeAddonLoad ??= import("@xterm/addon-serialize")
                .then(({ SerializeAddon }) => {
                    if (this.disposed) {
                        return;
                    }
                    this.serializeAddon = new SerializeAddon();
                    this.terminal.loadAddon(this.serializeAddon);
                    // Recheck stream safety after the import before taking an atomic snapshot.
                    this.processAndCacheData();
                })
                .catch((error) => {
                    this.serializeAddonLoad = null;
                    console.error("Terminal serializer load failed", error);
                });
            return;
        }
        const serializedOutput = this.serializeAddon.serialize();
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        const ptyOffset = this.ptyOffset;
        const epoch = this.fileEpoch;
        const termFileEpoch = this.termFileEpoch;
        const revision = (this.cacheRevision = Math.max(Date.now(), this.cacheRevision + 1));
        const commandIndex = JSON.stringify(
            makeCmdBlockIndexSnapshot(
                this.cmdBlocks,
                ptyOffset,
                termSize.cols,
                this.terminal.options.scrollback,
                this.terminal.buffer.active.length
            )
        );
        console.log("idle timeout term", this.dataBytesProcessed, serializedOutput.length, termSize);
        this.cacheSaveQueue = this.cacheSaveQueue
            .catch((error) => console.error("Terminal cache save failed", error))
            .then(async () => {
                if (this.disposed || epoch !== this.fileEpoch) {
                    return;
                }
                const hash = await hashTerminalSnapshot(
                    serializedOutput,
                    ptyOffset,
                    termSize,
                    commandIndex,
                    termFileEpoch,
                    revision
                );
                if (this.disposed || epoch !== this.fileEpoch) {
                    return;
                }
                await services.BlockService.SaveTerminalState(
                    this.blockId,
                    serializedOutput,
                    "full",
                    ptyOffset,
                    termSize,
                    commandIndex,
                    hash,
                    termFileEpoch,
                    revision
                );
            });
        fireAndForget(() => this.cacheSaveQueue);
        this.dataBytesProcessed = 0;
        this.cmdBlocksCacheDirty = false;
    }

    runProcessIdleTimeout() {
        if (this.disposed) {
            return;
        }
        this.cacheTimer = window.setTimeout(() => {
            this.cacheTimer = null;
            this.cacheIdleCallback = window.requestIdleCallback(() => {
                this.cacheIdleCallback = null;
                if (this.disposed) {
                    return;
                }
                this.processAndCacheData();
                this.runProcessIdleTimeout();
            });
        }, 5000);
    }

    async pasteHandler(e?: ClipboardEvent): Promise<void> {
        this.pasteActive = true;
        e?.preventDefault();
        e?.stopPropagation();

        try {
            const clipboardData = await extractAllClipboardData(e);
            let firstImage = true;
            for (const data of clipboardData) {
                if (data.image && SupportsImageInput) {
                    if (!firstImage) {
                        await new Promise((r) => setTimeout(r, 150));
                    }
                    const tempPath = await createTempFileFromBlob(data.image);
                    this.terminal.paste(tempPath + " ");
                    firstImage = false;
                }
                if (data.text) {
                    this.terminal.paste(data.text);
                }
            }
        } catch (err) {
            console.error("Paste error:", err);
        } finally {
            setTimeout(() => {
                this.pasteActive = false;
            }, 30);
        }
    }

    getScrollbackContent(): string {
        if (!this.terminal) {
            return "";
        }
        const buffer = this.terminal.buffer.active;
        const lines = bufferLinesToText(buffer, 0, buffer.length);
        return lines.join("\n");
    }

    // Command-block index lifecycle, driven by shell-integration OSC 16162 (A/C/D).
    // A new command block spans from one prompt-start (A) marker to the next.
    onPromptStart(marker: TermTypes.IMarker, replaying = false) {
        this.localCompletionInputBuffer = emptyPromptInputBuffer();
        // typeahead queued while the previous command ran lands in this prompt's line
        // editor without passing through the mirror, so the mirror can't be trusted here.
        this.localCompletionInputDisabled = this.inputSentWhileRunning;
        this.inputSentWhileRunning = false;
        this.shellInputReportSeen = false;
        globalStore.set(
            this.currentInputBufferAtom,
            this.localCompletionInputDisabled ? null : { text: "", cursorIndex: 0 }
        );
        const prev = this.pendingCmdBlock;
        if (prev != null) {
            prev.endMarker = marker;
            if (!blockHasCommand(prev)) {
                // an A with no following C = empty Enter; don't keep it as a block
                this.cmdBlocks = this.cmdBlocks.filter((b) => b !== prev);
            } else {
                this.finalizeInterruptedCmdBlock(prev, replaying);
            }
        }
        const block: CmdBlock = {
            id: ++this.cmdBlockIdCounter,
            startMarker: marker,
            outputMarker: null,
            endMarker: null,
            command: null,
            exitCode: null,
            state: "running",
            startTs: 0,
            doneTs: null,
            cwd: null,
        };
        this.pendingCmdBlock = block;
        this.cmdBlocks.push(block);
        this.publishCmdBlocks();
        // prev's endMarker just got set - its card region is now bounded, so re-sync.
        this.scheduleCmdDecorationSync();
    }

    onCommandStart(command: string | null, replaying = false) {
        if (this.pendingCmdBlock == null) {
            return;
        }
        const outputMarker = this.terminal.registerMarker(0);
        if (outputMarker != null) {
            this.pendingCmdBlock.outputMarker = outputMarker;
            this.outputMarkers.push(outputMarker);
            outputMarker.onDispose(() => {
                const index = this.outputMarkers.indexOf(outputMarker);
                if (index !== -1) {
                    this.outputMarkers.splice(index, 1);
                }
            });
        }
        this.pendingCmdBlock.command = command;
        this.pendingCmdBlock.startTs = replaying ? 0 : Date.now();
        this.pendingCmdBlock.cwd = replaying
            ? null
            : (globalStore.get(getBlockMetaKeyAtom(this.blockId, "cmd:cwd")) as string) || null;
        this.publishCmdBlocks();
    }

    onCommandDone(exitCode: number | null, replaying = false) {
        if (this.pendingCmdBlock == null) {
            return;
        }
        const block = this.pendingCmdBlock;
        const canNotify = block.state === "running" && !block.interrupted;
        block.exitCode = exitCode;
        block.state = "done";
        block.interrupted = false;
        block.doneTs = replaying ? null : Date.now();
        if (block.doneTs == null) {
            // a restored running block keeps its real startTs, but the replayed D carries
            // no timestamp - hide the duration instead of letting it grow forever.
            block.startTs = 0;
        }
        if (!replaying) {
            this.cmdBlocksCacheDirty = true;
            if (canNotify) {
                this.notifyCommandDone(block);
            }
        }
        const inlineAIPrompt = getInlineAICommandPrompt(block);
        const commandComposerEnabled = globalStore.get(getSettingsKeyAtom("term:commandcomposer")) !== false;
        if (!replaying && commandComposerEnabled && inlineAIPrompt && shouldAutoComposeInlineAI(block)) {
            this.onInlineAIRequest?.(inlineAIPrompt, block, { auto: true });
        }
        this.publishCmdBlocks();
        this.scheduleCmdDecorationSync();
    }

    notifyCommandDone(block: CmdBlock) {
        const nowMs = performance.now();
        if (
            !shouldNotifyCommandDone({
                block,
                thresholdSeconds: globalStore.get(this.notifyAfterAtom) ?? 10,
                windowFocused: document.hasFocus(),
                tabActive: globalStore.get(getTabModelByTabId(this.tabId).isActiveAtom),
                blockFocused: this.nodeModel != null && globalStore.get(this.nodeModel.isFocused),
                nowMs,
                lastNotificationMs: this.lastCommandNotificationMs,
            })
        ) {
            return;
        }
        this.lastCommandNotificationMs = nowMs;
        const connection = globalStore.get(getBlockMetaKeyAtom(this.blockId, "connection"));
        const opts = {
            ...formatCommandNotification(block, connection, getLocalHomeDir()),
            tabid: this.tabId,
            blockid: this.blockId,
        };
        fireAndForget(() => RpcApi.NotifyCommand(TabRpcClient, opts, { route: "electron", timeout: 5000 }));
    }

    // A block whose command never reported D (shell killed, exec'd, or restarted) must
    // not stay "Running" forever; close it with an unknown result.
    finalizeInterruptedCmdBlock(block: CmdBlock, replaying = false): boolean {
        if (block == null || block.state !== "running" || !blockHasCommand(block)) {
            return false;
        }
        block.state = "done";
        block.exitCode = null;
        block.interrupted = true;
        block.doneTs = replaying || !block.startTs ? null : Date.now();
        if (block.doneTs == null) {
            block.startTs = 0;
        }
        if (!replaying) {
            this.cmdBlocksCacheDirty = true;
        }
        this.publishCmdBlocks();
        this.scheduleCmdDecorationSync();
        return true;
    }

    onShellRestart(replaying = false) {
        this.finalizeInterruptedCmdBlock(this.pendingCmdBlock, replaying);
    }

    // Shell-integration OSC 16162 "I" report: the live prompt input buffer + cursor.
    // Drives inline command completion. cur is a character offset from the shell;
    // charOffsetToStringIndex normalizes it to a JS UTF-16 string index.
    handleInputReport(data: { buf64?: string; cur?: number; len?: number; toolarge?: boolean; inputempty?: boolean }) {
        if (data.buf64 != null || data.toolarge === true) {
            this.shellInputReportSeen = true;
        }
        if (data.toolarge) {
            globalStore.set(this.currentInputBufferAtom, null);
            return;
        }
        if (data.buf64 == null) {
            // legacy boolean form (older shells): only the empty signal is meaningful
            if (data.inputempty === true) {
                const inputBuffer = emptyPromptInputBuffer();
                this.localCompletionInputBuffer = inputBuffer;
                globalStore.set(this.currentInputBufferAtom, inputBuffer);
            }
            return;
        }
        let text = "";
        try {
            text = base64ToString(data.buf64);
        } catch (e) {
            globalStore.set(this.currentInputBufferAtom, null);
            return;
        }
        const cursorIndex = charOffsetToStringIndex(text, data.cur ?? text.length);
        const inputBuffer = { text, cursorIndex };
        this.localCompletionInputBuffer = inputBuffer;
        globalStore.set(this.currentInputBufferAtom, inputBuffer);
    }

    updateHoveredBlockFromMouse(event: MouseEvent) {
        if (!this.loaded || !this.semanticBlocksEnabled || this.terminal.rows < 1) {
            return;
        }
        const buffer = this.terminal.buffer.active;
        if (buffer.type === "alternate") {
            globalStore.set(this.hoveredBlockIdAtom, null);
            return;
        }
        const rect = this.connectElem.getBoundingClientRect();
        const cellHeight = rect.height / this.terminal.rows;
        if (cellHeight <= 0) {
            return;
        }
        const row = Math.floor((event.clientY - rect.top) / cellHeight);
        const line = buffer.viewportY + row;
        const hovered = findCmdBlockAtLine(this.cmdBlocks, line, buffer);
        const nextId = hovered?.id ?? null;
        if (globalStore.get(this.hoveredBlockIdAtom) !== nextId) {
            globalStore.set(this.hoveredBlockIdAtom, nextId);
        }
    }

    setSemanticBlocksEnabled(enabled: boolean) {
        if (this.semanticBlocksEnabled === enabled) {
            return;
        }
        this.semanticBlocksEnabled = enabled;
        this.scheduleCmdDecorationSync();
    }

    scheduleCmdDecorationSync() {
        this.syncCmdDecorations_debounced();
    }

    // Warp-style command blocks via xterm decorations: each finished command gets a
    // full-width card drawn BEHIND the live text (layer "bottom"), anchored to its
    // prompt-start marker. xterm auto-positions/clips it to the viewport and on scroll,
    // and returns undefined in the alt buffer - so full-screen TUIs are handled for free.
    // Output is never copied or removed from the buffer: it renders exactly once, so
    // there is no double-render and no capture to go stale.
    syncCmdDecorations() {
        if (!this.loaded || !this.semanticBlocksEnabled) {
            this.disposeCmdDecorations();
            return;
        }
        const buffer = this.terminal.buffer.active;
        if (buffer.type === "alternate") {
            this.disposeCmdDecorations();
            return;
        }
        const seen = new Set<number>();
        for (const spec of makeCmdBlockDecorationSpecs(this.cmdBlocks, buffer, this.terminal.cols)) {
            const { block, cols, rows } = spec;
            const status = getCmdBlockStatus(block);
            seen.add(block.id);
            const existing = this.cmdDecorations.get(block.id);
            if (
                existing?.marker === block.startMarker &&
                existing.cols === cols &&
                existing.rows === rows &&
                existing.tone === status.tone
            ) {
                continue;
            }
            existing?.decoration.dispose();
            const decoration = this.terminal.registerDecoration({
                marker: block.startMarker,
                width: cols,
                height: rows,
                layer: "bottom",
            });
            if (decoration == null) {
                this.cmdDecorations.delete(block.id);
                continue;
            }
            decoration.onRender((el) => {
                el.classList.add("term-cmdblock-deco", `is-${status.tone}`);
            });
            this.cmdDecorations.set(block.id, {
                decoration,
                marker: block.startMarker,
                cols,
                rows,
                tone: status.tone,
            });
        }
        for (const [id, existing] of this.cmdDecorations) {
            if (!seen.has(id)) {
                existing.decoration.dispose();
                this.cmdDecorations.delete(id);
            }
        }
    }

    handleCmdBlockMarkerDisposed(marker: TermTypes.IMarker) {
        const before = this.cmdBlocks.length;
        const removedBlock = this.cmdBlocks.find((b) => b.startMarker === marker);
        this.cmdBlocks = this.cmdBlocks.filter((b) => b.startMarker !== marker);
        if (this.pendingCmdBlock?.startMarker === marker) {
            this.pendingCmdBlock = null;
        }
        if (removedBlock != null && globalStore.get(this.hoveredBlockIdAtom) === removedBlock.id) {
            globalStore.set(this.hoveredBlockIdAtom, null);
        }
        if (this.cmdBlocks.length !== before) {
            this.publishCmdBlocks();
            this.scheduleCmdDecorationSync();
        }
    }

    resetCmdBlocks() {
        this.cmdBlocks = [];
        this.pendingCmdBlock = null;
        this.outputMarkers.forEach((marker) => marker.dispose());
        this.outputMarkers = [];
        globalStore.set(this.hoveredBlockIdAtom, null);
        this.publishCmdBlocks();
        this.scheduleCmdDecorationSync();
    }
}
