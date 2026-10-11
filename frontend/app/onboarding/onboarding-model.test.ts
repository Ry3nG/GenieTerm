// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { ClientModel } from "@/app/store/client-model";
import { atoms, getBlockComponentModel, getFocusedBlockId, refocusNode, WOS } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as jotai from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitOnboardingEvent, type OnboardingEvent } from "./onboarding-events";
import {
    getQuickStartProgress,
    isFailedCommandExit,
    isQuickStartStep,
    nextQuickStartStep,
    OnboardingModel,
    type QuickStartStep,
    whenOnboardingMetaSaved,
} from "./onboarding-model";

vi.mock("@/app/store/global", async () => {
    const { atom } = await import("jotai");
    const { globalStore } = await import("@/app/store/jotaiStore");
    return {
        globalStore,
        atoms: { staticTabId: atom("tab-1") },
        getBlockComponentModel: vi.fn(),
        getFocusedBlockId: vi.fn(),
        refocusNode: vi.fn(),
        WOS: {
            makeORef: (type: string, id: string) => `${type}:${id}`,
            getWaveObjectAtom: vi.fn(() => atom({ blockids: ["block-1", "block-2"] })),
        },
    };
});

vi.mock("@/app/store/client-model", async () => {
    const { atom } = await import("jotai");
    const client = { clientId: "client-1", clientAtom: atom({ meta: {} }) };
    return { ClientModel: { getInstance: () => client } };
});

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { SetMetaCommand: vi.fn(async () => {}) },
}));

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

const Steps: QuickStartStep[] = ["command", "blocks", "commandai", "files", "done"];
const CommandDone: OnboardingEvent = {
    type: "command-done",
    blockId: "block-2",
    cmdBlockId: "cmd-1",
    command: "ls",
    exitCode: 0,
};
const FailedCommand: OnboardingEvent = { ...CommandDone, command: "git stauts", exitCode: 1 };
const RemoteReady: OnboardingEvent = { type: "connection-ready", blockId: "block-2", connection: "dev@example.com" };

function setClientMeta(meta: MetaType) {
    globalStore.set(ClientModel.getInstance().clientAtom as jotai.PrimitiveAtom<Client>, { meta } as Client);
}

async function expectSaved(meta: MetaType) {
    await whenOnboardingMetaSaved();
    expect(RpcApi.SetMetaCommand).toHaveBeenLastCalledWith(TabRpcClient, { oref: "client:client-1", meta });
}

describe("onboarding helpers", () => {
    it.each([
        ["command", 1],
        ["blocks", 1],
        ["commandai", 2],
        ["files", 3],
        ["done", 3],
    ] as const)("reports progress for %s", (step, index) => {
        expect(getQuickStartProgress(step)).toEqual({ index, total: 3 });
    });

    it.each([
        ["command", "blocks", "blocks"],
        ["blocks", "commandai", "files"],
        ["commandai", "files", "files"],
        ["files", "done", "done"],
        ["done", "done", "done"],
    ] as const)("advances %s and skips unavailable Command AI", (step, available, unavailable) => {
        expect(nextQuickStartStep(step, { commandAiAvailable: true })).toBe(available);
        expect(nextQuickStartStep(step, { commandAiAvailable: false })).toBe(unavailable);
    });

    it.each(Steps)("recognizes the %s step", (step) => {
        expect(isQuickStartStep(step)).toBe(true);
    });

    it.each([null, undefined, "", "active", "COMMAND", 0, false, {}, ["command"]])(
        "rejects invalid step %j",
        (value) => {
            expect(isQuickStartStep(value)).toBe(false);
        }
    );

    it.each([
        [0, "ls", false],
        [1, "git stauts", true],
        [2, "npm run build", true],
        [130, "sleep 10", false],
        [143, "sleep 10", false],
        [-1, "ls", false],
        [127, "git stauts", true],
        [127, "show me disk usage please", false],
        [null, "ls", false],
        [undefined, "ls", false],
    ] as const)("classifies exit %s for %s", (exitCode, command, failed) => {
        expect(isFailedCommandExit(exitCode, command)).toBe(failed);
    });
});

describe("OnboardingModel", () => {
    let model: OnboardingModel;
    let commandAiEnabledAtom: jotai.PrimitiveAtom<boolean>;
    let querySelector: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        OnboardingModel.resetInstance();
        vi.clearAllMocks();
        vi.useFakeTimers();
        setClientMeta({});
        globalStore.set(atoms.staticTabId as jotai.PrimitiveAtom<string>, "tab-1");
        const tabAtom = jotai.atom({ blockids: ["block-1", "block-2"] } as Tab);
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(tabAtom);
        commandAiEnabledAtom = jotai.atom(true);
        vi.mocked(getFocusedBlockId).mockReturnValue("block-1");
        vi.mocked(getBlockComponentModel).mockImplementation(
            () =>
                ({ viewModel: { viewType: "term", commandAiEnabledAtom } }) as unknown as ReturnType<
                    typeof getBlockComponentModel
                >
        );
        querySelector = vi.fn(() => null);
        vi.stubGlobal("document", { querySelector });
        model = OnboardingModel.getInstance();
        model.init();
    });

    afterEach(async () => {
        await whenOnboardingMetaSaved();
        OnboardingModel.resetInstance();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("completes the event-driven quick start and persists every step", async () => {
        expect(model.isActive()).toBe(false);
        model.start();
        expect(model.getStep()).toBe("command");
        expect(globalStore.get(model.activeAtom)).toBe(true);
        expect(globalStore.get(model.targetBlockIdAtom)).toBe("block-1");
        await expectSaved({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "command" });

        emitOnboardingEvent(CommandDone);
        expect(model.getStep()).toBe("blocks");
        expect(globalStore.get(model.targetBlockIdAtom)).toBe("block-2");
        await expectSaved({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "blocks" });

        model.advance();
        expect(model.getStep()).toBe("commandai");
        expect(globalStore.get(model.commandAiOpenedAtom)).toBe(false);
        await expectSaved({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "commandai" });

        emitOnboardingEvent({ type: "commandai-opened", blockId: "block-2" });
        expect(globalStore.get(model.commandAiOpenedAtom)).toBe(true);
        expect(model.getStep()).toBe("commandai");
        await whenOnboardingMetaSaved();
        expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(3);

        emitOnboardingEvent({ type: "commandai-applied", blockId: "block-2", mode: "insert" });
        expect(model.getStep()).toBe("files");
        expect(globalStore.get(model.commandAiOpenedAtom)).toBe(false);
        await expectSaved({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "files" });

        emitOnboardingEvent({ type: "cwd-files-opened", blockId: "block-2", filesBlockId: "files-1" });
        expect(model.getStep()).toBe("done");
        await expectSaved({ "onboarding:quickstart": "done", "onboarding:quickstartstep": null });
        expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(5);

        model.finish();
        expect(model.getStep()).toBeNull();
        expect(model.isActive()).toBe(false);
        expect(globalStore.get(model.activeAtom)).toBe(false);
        await whenOnboardingMetaSaved();
        expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(5);
    });

    it.each(Steps)("ignores events for the wrong step while on %s", async (step) => {
        model.start();
        if (step !== "command") {
            model.setStep(step);
        }
        await whenOnboardingMetaSaved();
        vi.mocked(RpcApi.SetMetaCommand).mockClear();
        const events: { validStep: QuickStartStep; event: OnboardingEvent }[] = [
            { validStep: "command", event: CommandDone },
            { validStep: "commandai", event: { type: "commandai-opened", blockId: "block-2" } },
            { validStep: "commandai", event: { type: "commandai-applied", blockId: "block-2", mode: "run" } },
            { validStep: "files", event: { type: "cwd-files-opened", blockId: "block-2", filesBlockId: "files-1" } },
        ];
        for (const { validStep, event } of events) {
            if (step === validStep) {
                continue;
            }
            emitOnboardingEvent(event);
            expect(model.getStep()).toBe(step);
            expect(globalStore.get(model.targetBlockIdAtom)).toBe("block-1");
            expect(globalStore.get(model.commandAiOpenedAtom)).toBe(false);
        }
        await whenOnboardingMetaSaved();
        expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
    });

    it("skips Command AI in the model when disabled for the target terminal", async () => {
        globalStore.set(commandAiEnabledAtom, false);
        model.start();
        emitOnboardingEvent(CommandDone);
        model.advance();
        expect(model.getStep()).toBe("files");
        await expectSaved({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "files" });
    });

    it.each(Steps.filter((step) => step !== "done"))("persists dismissed and the unfinished %s step", async (step) => {
        model.start(step);
        model.dismiss();
        expect(model.getStep()).toBeNull();
        expect(model.isActive()).toBe(false);
        await expectSaved({ "onboarding:quickstart": "dismissed", "onboarding:quickstartstep": step });
    });

    it.each(["active", "dismissed"] as const)("resumes an unfinished %s run from the palette", async (status) => {
        setClientMeta({ "onboarding:quickstart": status, "onboarding:quickstartstep": "files" });
        model.startFromPalette();
        expect(model.getStep()).toBe("files");
        await expectSaved({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "files" });
    });

    it.each([null, "files", "done"] as const)(
        "restarts a completed run with saved step %s from the palette",
        async (step) => {
            setClientMeta({ "onboarding:quickstart": "done", "onboarding:quickstartstep": step });
            model.startFromPalette();
            expect(model.getStep()).toBe("command");
            await expectSaved({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "command" });
        }
    );

    it("unsubscribes the previous singleton on reset", async () => {
        model.start();
        OnboardingModel.resetInstance();
        const nextModel = OnboardingModel.getInstance();
        nextModel.start();
        await whenOnboardingMetaSaved();
        vi.mocked(RpcApi.SetMetaCommand).mockClear();
        emitOnboardingEvent(CommandDone);
        expect(model.getStep()).toBe("command");
        expect(nextModel.getStep()).toBe("blocks");
        await whenOnboardingMetaSaved();
        expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(1);
    });

    it("queues status writes until the preceding write completes", async () => {
        let resolveWrite: () => void;
        const pendingWrite = new Promise<void>((resolve) => {
            resolveWrite = resolve;
        });
        vi.mocked(RpcApi.SetMetaCommand).mockImplementationOnce(() => pendingWrite);

        model.start();
        model.dismiss();
        try {
            expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
            await Promise.resolve();
            expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(1);
            expect(RpcApi.SetMetaCommand).toHaveBeenNthCalledWith(1, TabRpcClient, {
                oref: "client:client-1",
                meta: { "onboarding:quickstart": "active", "onboarding:quickstartstep": "command" },
            });
        } finally {
            resolveWrite();
            await whenOnboardingMetaSaved();
        }
        expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(2);
        await expectSaved({ "onboarding:quickstart": "dismissed", "onboarding:quickstartstep": "command" });
    });

    it.each([
        ["command", CommandDone],
        ["commandai", { type: "commandai-opened", blockId: "block-2" }],
        ["commandai", { type: "commandai-applied", blockId: "block-2", mode: "run" }],
        ["files", { type: "cwd-files-opened", blockId: "block-2", filesBlockId: "files-1" }],
    ] satisfies [QuickStartStep, OnboardingEvent][])("ignores background-tab events on %s: %j", async (step, event) => {
        model.start(step);
        await whenOnboardingMetaSaved();
        vi.mocked(RpcApi.SetMetaCommand).mockClear();

        emitOnboardingEvent({ ...event, blockId: "background-block" });
        expect(model.getStep()).toBe(step);
        expect(globalStore.get(model.targetBlockIdAtom)).toBe("block-1");
        expect(globalStore.get(model.commandAiOpenedAtom)).toBe(false);
        await whenOnboardingMetaSaved();
        expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
    });

    it("selects a terminal in the active tab when the focused block is in a background tab", () => {
        vi.mocked(getFocusedBlockId).mockReturnValue("background-block");
        model.start();
        expect(globalStore.get(model.targetBlockIdAtom)).toBe("block-1");
        expect(model.getTargetBlockId()).toBe("block-1");
        expect(WOS.getWaveObjectAtom).toHaveBeenCalledWith("tab:tab-1");
    });

    it("replaces a stale target after switching tabs and returns no target when that tab has no blocks", () => {
        model.start();
        globalStore.set(atoms.staticTabId as jotai.PrimitiveAtom<string>, "tab-2");
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(jotai.atom({ blockids: ["block-3"] } as Tab));
        expect(model.getTargetBlockId()).toBe("block-3");
        expect(WOS.getWaveObjectAtom).toHaveBeenLastCalledWith("tab:tab-2");

        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(jotai.atom({ blockids: [] } as Tab));
        expect(model.getTargetBlockId()).toBeNull();
    });

    it.each(["done", "dismissed", null] as const)(
        "stops without further writes when another window changes the saved status to %s",
        async (status) => {
            model.start();
            await whenOnboardingMetaSaved();
            expect(model.writingStatus).toBe(false);
            vi.mocked(RpcApi.SetMetaCommand).mockClear();

            setClientMeta({ "onboarding:quickstart": status });
            expect(model.getStep()).toBeNull();
            expect(globalStore.get(model.activeAtom)).toBe(false);
            model.advance();
            emitOnboardingEvent(CommandDone);
            emitOnboardingEvent({ type: "commandai-applied", blockId: "block-2", mode: "run" });
            emitOnboardingEvent({ type: "cwd-files-opened", blockId: "block-2", filesBlockId: "files-1" });
            await whenOnboardingMetaSaved();
            expect(model.isActive()).toBe(false);
            expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
        }
    );

    it("keeps the local run active when another window saves active progress", async () => {
        model.start();
        await whenOnboardingMetaSaved();
        vi.mocked(RpcApi.SetMetaCommand).mockClear();
        setClientMeta({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "files" });
        expect(model.getStep()).toBe("command");
        await whenOnboardingMetaSaved();
        expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
    });

    it("ignores stale client status while writing its own active status", async () => {
        model.start();
        expect(model.writingStatus).toBe(true);
        setClientMeta({ "onboarding:quickstart": "done" });
        expect(model.getStep()).toBe("command");
        await whenOnboardingMetaSaved();
        expect(model.writingStatus).toBe(false);

        setClientMeta({ "onboarding:quickstart": "done" });
        expect(model.isActive()).toBe(false);
        await whenOnboardingMetaSaved();
        expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(1);
    });

    it("unsubscribes from client changes on reset", async () => {
        model.start();
        await whenOnboardingMetaSaved();
        OnboardingModel.resetInstance();
        setClientMeta({ "onboarding:quickstart": "done" });
        expect(model.getStep()).toBe("command");
    });

    it("refocuses the target terminal after starting", () => {
        vi.mocked(getFocusedBlockId).mockReturnValue("block-2");
        const refocusTarget = vi.spyOn(model, "refocusTarget");
        model.start();
        vi.advanceTimersByTime(49);
        expect(refocusTarget).not.toHaveBeenCalled();
        expect(refocusNode).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(refocusTarget).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(10);
        expect(refocusNode).toHaveBeenCalledExactlyOnceWith("block-2");
    });

    describe("tips", () => {
        it.each(["fix", "remote"] as const)(
            "does not consume an offered %s tip or the session allowance until marked shown",
            async (id) => {
                setClientMeta({ "onboarding:quickstart": "done" });
                querySelector.mockReturnValue({});
                emitOnboardingEvent(id === "fix" ? FailedCommand : RemoteReady);
                expect(globalStore.get(model.tipAtom)?.id).toBe(id);
                expect(model.tipShownThisSession).toBe(false);
                expect(model.hasSeenTip(id)).toBe(false);
                expect(model.canShowTip("fix")).toBe(false);
                expect(model.canShowTip("remote")).toBe(false);
                await whenOnboardingMetaSaved();
                expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();

                model.dismissTip();
                expect(globalStore.get(model.tipAtom)).toBeNull();
                expect(model.tipShownThisSession).toBe(false);
                expect(model.hasSeenTip(id)).toBe(false);
                expect(model.canShowTip("fix")).toBe(true);
                expect(model.canShowTip("remote")).toBe(true);
                emitOnboardingEvent(id === "fix" ? FailedCommand : RemoteReady);
                expect(globalStore.get(model.tipAtom)?.id).toBe(id);
                await whenOnboardingMetaSaved();
                expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
            }
        );

        it.each(["fix", "remote"] as const)("persists a shown %s tip once and skips it once saved", async (id) => {
            setClientMeta({ "onboarding:quickstart": "done" });
            model.showTip({ id, blockId: "block-2" });
            model.markTipShown(id);
            expect(model.tipShownThisSession).toBe(true);
            await expectSaved({ "onboarding:tips": [id] });
            expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(1);

            setClientMeta({ "onboarding:quickstart": "done", "onboarding:tips": [id] });
            model.markTipShown(id);
            model.dismissTip();
            expect(model.hasSeenTip(id)).toBe(true);
            expect(model.canShowTip(id)).toBe(false);
            await whenOnboardingMetaSaved();
            expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(1);
        });

        it.each(Steps)("does not show tips while quick start is on %s", (step) => {
            setClientMeta({ "onboarding:quickstart": "done" });
            model.start();
            if (step !== "command") {
                model.setStep(step);
            }
            querySelector.mockReturnValue({});
            emitOnboardingEvent(FailedCommand);
            emitOnboardingEvent(RemoteReady);
            expect(globalStore.get(model.tipAtom)).toBeNull();
            expect(model.tipShownThisSession).toBe(false);
        });

        it("does not show tips when saved quick start is active in another window", async () => {
            setClientMeta({ "onboarding:quickstart": "active", "onboarding:quickstartstep": "files" });
            querySelector.mockReturnValue({});
            emitOnboardingEvent(FailedCommand);
            emitOnboardingEvent(RemoteReady);
            expect(globalStore.get(model.tipAtom)).toBeNull();
            await whenOnboardingMetaSaved();
            expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
        });

        it.each(["done", "dismissed"] as const)(
            "shows and records a fix tip after a failure when %s",
            async (status) => {
                setClientMeta({ "onboarding:quickstart": status, "onboarding:tips": ["remote"] });
                emitOnboardingEvent(FailedCommand);
                expect(globalStore.get(model.tipAtom)).toEqual({ id: "fix", blockId: "block-2" });
                model.markTipShown("fix");
                await expectSaved({ "onboarding:tips": ["remote", "fix"] });
                expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(1);
            }
        );

        it("does not show a fix tip for an interrupted command", async () => {
            setClientMeta({ "onboarding:quickstart": "done" });
            emitOnboardingEvent({ ...FailedCommand, exitCode: 130 });
            expect(globalStore.get(model.tipAtom)).toBeNull();
            expect(model.tipShownThisSession).toBe(false);
            await whenOnboardingMetaSaved();
            expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
        });

        it("does not show a fix tip when Command AI is unavailable", async () => {
            setClientMeta({ "onboarding:quickstart": "done" });
            globalStore.set(commandAiEnabledAtom, false);
            emitOnboardingEvent(FailedCommand);
            expect(globalStore.get(model.tipAtom)).toBeNull();
            await whenOnboardingMetaSaved();
            expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
        });

        it("dismisses a fix tip only when Command AI opens for the same block", () => {
            setClientMeta({ "onboarding:quickstart": "dismissed" });
            emitOnboardingEvent(FailedCommand);
            emitOnboardingEvent({ type: "commandai-opened", blockId: "block-1" });
            expect(globalStore.get(model.tipAtom)).toEqual({ id: "fix", blockId: "block-2" });
            emitOnboardingEvent({ type: "commandai-opened", blockId: "block-2" });
            expect(globalStore.get(model.tipAtom)).toBeNull();
        });

        it.each(["fix", "remote"] as const)("shows only one tip per session after a %s tip", async (firstTip) => {
            setClientMeta({ "onboarding:quickstart": "done" });
            querySelector.mockReturnValue({});
            emitOnboardingEvent(firstTip === "fix" ? FailedCommand : RemoteReady);
            expect(globalStore.get(model.tipAtom)?.id).toBe(firstTip);
            model.markTipShown(firstTip);
            model.dismissTip();
            emitOnboardingEvent(FailedCommand);
            emitOnboardingEvent(RemoteReady);
            expect(globalStore.get(model.tipAtom)).toBeNull();
            await whenOnboardingMetaSaved();
            expect(RpcApi.SetMetaCommand).toHaveBeenCalledTimes(1);
        });

        it("never repeats a seen fix tip, including in a fresh session", async () => {
            setClientMeta({ "onboarding:quickstart": "done", "onboarding:tips": ["fix"] });
            for (let session = 0; session < 2; session++) {
                OnboardingModel.resetInstance();
                model = OnboardingModel.getInstance();
                model.init();
                emitOnboardingEvent(FailedCommand);
                expect(globalStore.get(model.tipAtom)).toBeNull();
                expect(model.tipShownThisSession).toBe(false);
            }
            await whenOnboardingMetaSaved();
            expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();
        });

        it("shows a remote tip only when the widget host anchor exists", async () => {
            setClientMeta({ "onboarding:quickstart": "done" });
            emitOnboardingEvent(RemoteReady);
            expect(querySelector).toHaveBeenCalledWith('[data-onboarding="widget-host"]');
            expect(globalStore.get(model.tipAtom)).toBeNull();
            expect(model.tipShownThisSession).toBe(false);
            await whenOnboardingMetaSaved();
            expect(RpcApi.SetMetaCommand).not.toHaveBeenCalled();

            querySelector.mockReturnValue({});
            emitOnboardingEvent(RemoteReady);
            expect(globalStore.get(model.tipAtom)).toEqual({
                id: "remote",
                blockId: "block-2",
                connection: "dev@example.com",
            });
            model.markTipShown("remote");
            await expectSaved({ "onboarding:tips": ["remote"] });
        });
    });
});
