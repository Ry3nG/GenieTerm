// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore, replaceBlock } from "@/app/store/global";
import type { TabModel } from "@/app/store/tab-model";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";

type AgentDef = {
    key: string;
    label: string;
    bin: string;
    icon: string;
    color: string;
    description: string;
    install: string;
    docsUrl: string;
};

// Known coding-agent CLIs GenieTerm hosts. Launching runs the real CLI in a
// term+cmd block (through a login shell, so PATH resolves), keeping GenieTerm a
// neutral host rather than a competing built-in chat.
const AGENTS: AgentDef[] = [
    {
        key: "claude",
        label: "Claude Code",
        bin: "claude",
        icon: "sparkles",
        color: "#d97757",
        description: "Anthropic's agentic coding CLI",
        install: "npm i -g @anthropic-ai/claude-code",
        docsUrl: "https://claude.ai/code",
    },
    {
        key: "codex",
        label: "Codex",
        bin: "codex",
        icon: "robot",
        color: "#10a37f",
        description: "OpenAI's coding agent CLI",
        install: "npm i -g @openai/codex",
        docsUrl: "https://developers.openai.com/codex/cli",
    },
    {
        key: "gemini",
        label: "Gemini CLI",
        bin: "gemini",
        icon: "gem",
        color: "#4285f4",
        description: "Google's Gemini coding CLI",
        install: "npm i -g @google/gemini-cli",
        docsUrl: "https://github.com/google-gemini/gemini-cli",
    },
];

export class AgentsViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewType = "agents";
    viewIcon = atom("robot");
    viewName = atom("Agents");
    viewComponent = AgentsView;
    noHeader = atom(false);
    inputRef = { current: null } as React.RefObject<HTMLInputElement>;
    selectedIndex = atom(0);

    constructor({ blockId, nodeModel, tabModel }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
    }

    giveFocus(): boolean {
        if (this.inputRef.current) {
            this.inputRef.current.focus();
            return true;
        }
        return false;
    }

    async launch(agent: AgentDef) {
        try {
            await replaceBlock(
                this.blockId,
                { meta: { view: "term", controller: "cmd", cmd: agent.bin, "cmd:shell": true } },
                true
            );
        } catch (error) {
            console.error("Error launching agent:", error);
        }
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        const idx = globalStore.get(this.selectedIndex);
        if (checkKeyPressed(e, "ArrowDown")) {
            globalStore.set(this.selectedIndex, Math.min(idx + 1, AGENTS.length - 1));
            return true;
        }
        if (checkKeyPressed(e, "ArrowUp")) {
            globalStore.set(this.selectedIndex, Math.max(idx - 1, 0));
            return true;
        }
        if (checkKeyPressed(e, "Enter")) {
            if (AGENTS[idx]) {
                this.launch(AGENTS[idx]);
            }
            return true;
        }
        return false;
    }
}

function AgentsView({ model }: ViewComponentProps<AgentsViewModel>) {
    const selectedIndex = useAtomValue(model.selectedIndex);
    return (
        <div className="w-full h-full overflow-auto p-5">
            <input
                ref={model.inputRef}
                type="text"
                onKeyDown={keydownWrapper(model.keyDownHandler.bind(model))}
                className="sr-only dummy"
                aria-label="Agents"
            />
            <div className="text-secondary text-[13px] mb-4">Launch a coding agent in a new terminal block.</div>
            <div className="flex flex-col gap-2.5 max-w-[560px]">
                {AGENTS.map((agent, index) => (
                    <button
                        key={agent.key}
                        onClick={() => model.launch(agent)}
                        className={clsx(
                            "flex items-center gap-3.5 text-left rounded-[10px] border px-4 py-3 cursor-pointer transition-colors",
                            index === selectedIndex
                                ? "border-accent bg-hoverbg"
                                : "border-border bg-modalbg hover:bg-hoverbg"
                        )}
                    >
                        <i
                            className={makeIconClass(agent.icon, true, { defaultIcon: "robot" })}
                            style={{ color: agent.color, fontSize: 22, width: 26, textAlign: "center" }}
                        />
                        <div className="flex-1 min-w-0">
                            <div className="text-foreground text-[14px] font-medium">{agent.label}</div>
                            <div className="text-secondary text-[12px]">{agent.description}</div>
                            <div className="text-muted text-[11px] font-mono mt-1 truncate">{agent.install}</div>
                        </div>
                        <i className="fa-sharp fa-solid fa-arrow-right text-muted text-[12px]" />
                    </button>
                ))}
            </div>
        </div>
    );
}

export default AgentsView;
