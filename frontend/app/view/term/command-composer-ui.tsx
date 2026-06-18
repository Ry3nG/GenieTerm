// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TermViewModel } from "@/app/view/term/term-model";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import type { CommandProposal } from "./command-composer";
import type { TermWrap } from "./termwrap";

type TermCommandComposerProps = {
    model: TermViewModel;
    blockData: Block;
    connStatus: ConnStatus;
    termWrap: TermWrap | null;
};

function riskLabel(proposal: CommandProposal): string {
    if (proposal.risk.label === "low") {
        return "low";
    }
    return proposal.risk.reasons.length > 0 ? `${proposal.risk.label}: ${proposal.risk.reasons.join(", ")}` : proposal.risk.label;
}

const TermCommandComposer = React.memo(({ model, blockData, connStatus, termWrap }: TermCommandComposerProps) => {
    const isOpen = jotai.useAtomValue(model.commandComposerOpenAtom);
    const [input, setInput] = jotai.useAtom(model.commandComposerInputAtom);
    const proposals = jotai.useAtomValue(model.commandComposerProposalsAtom);
    const status = jotai.useAtomValue(model.commandComposerStatusAtom);
    const error = jotai.useAtomValue(model.commandComposerErrorAtom);
    const confirmProposalId = jotai.useAtomValue(model.commandComposerConfirmProposalIdAtom);
    const inputRef = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [isOpen]);

    const contextInput = React.useMemo(
        () => ({
            blockMeta: blockData?.meta,
            connStatus,
            selectedOutput: termWrap?.terminal?.getSelection() ?? "",
            recentBlocks: termWrap?.cmdBlocks ?? [],
        }),
        [blockData?.meta, connStatus, termWrap]
    );

    const close = React.useCallback(() => {
        model.closeCommandComposer();
    }, [model]);

    const submit = React.useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            fireAndForget(() => model.generateCommandProposals(input, contextInput));
        },
        [contextInput, input, model]
    );

    const applyProposal = React.useCallback(
        (proposal: CommandProposal, confirmed: boolean) => {
            fireAndForget(() => model.applyCommandProposal(proposal, confirmed));
        },
        [model]
    );

    const onKeyDown = React.useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                close();
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                fireAndForget(() => model.generateCommandProposals(input, contextInput));
            }
        },
        [close, contextInput, input, model]
    );

    if (!isOpen) {
        return null;
    }

    return (
        <div className="term-command-composer" role="dialog" aria-label="Command Composer">
            <form className="term-command-composer-inputrow" onSubmit={submit}>
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    className="term-command-composer-input"
                    placeholder="Describe a shell command"
                    rows={2}
                />
                <button type="submit" className="term-command-composer-iconbtn cursor-pointer" title="Compose">
                    <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="term-command-composer-iconbtn cursor-pointer"
                    title="Close"
                    onClick={close}
                >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
            </form>
            {status === "loading" && <div className="term-command-composer-empty">Composing...</div>}
            {status === "error" && <div className="term-command-composer-error">{error || "Command composer failed"}</div>}
            {status !== "loading" && proposals.length === 0 && status !== "error" && (
                <div className="term-command-composer-empty">No proposals</div>
            )}
            {proposals.length > 0 && (
                <div className="term-command-composer-results">
                    {proposals.map((proposal) => {
                        const isConfirming = confirmProposalId === proposal.id;
                        return (
                            <div key={proposal.id} className="term-command-composer-proposal">
                                <div className="term-command-composer-command">{proposal.command}</div>
                                <div className="term-command-composer-meta">
                                    <span
                                        className={clsx(
                                            "term-command-composer-risk",
                                            `risk-${proposal.risk.label}`
                                        )}
                                    >
                                        {riskLabel(proposal)}
                                    </span>
                                    <span>{proposal.target}</span>
                                </div>
                                <div className="term-command-composer-explanation">{proposal.explanation}</div>
                                <div className="term-command-composer-actions">
                                    {isConfirming && (
                                        <span className="term-command-composer-confirm">Confirm insertion</span>
                                    )}
                                    <button
                                        type="button"
                                        className="term-command-composer-apply cursor-pointer"
                                        onClick={() => applyProposal(proposal, isConfirming)}
                                    >
                                        {isConfirming ? "Insert" : "Use"}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

TermCommandComposer.displayName = "TermCommandComposer";

export { TermCommandComposer };
