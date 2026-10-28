// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { ClientModel } from "@/app/store/client-model";
import { atoms, createBlock, getBlockComponentModel, getFocusedBlockId, globalStore, WOS } from "@/app/store/global";
import { atom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureTourModel, openFeatureTourTarget, savedFeatureStep } from "./feature-tour-model";
import { CurrentOnboardingVersion } from "./onboarding-common";
import { setClientMeta } from "./onboarding-model";

vi.mock("@/app/store/global", async () => {
    const { atom } = await import("jotai");
    const { globalStore } = await import("@/app/store/jotaiStore");
    return {
        globalStore,
        atoms: { staticTabId: atom("tab") },
        createBlock: vi.fn(async () => {}),
        getBlockComponentModel: vi.fn(),
        getFocusedBlockId: vi.fn(),
        refocusNode: vi.fn(),
        WOS: { makeORef: (type: string, id: string) => `${type}:${id}`, getWaveObjectAtom: vi.fn() },
    };
});
vi.mock("@/app/store/client-model", async () => {
    const { atom } = await import("jotai");
    const client = { clientAtom: atom({ meta: {} }) };
    return { ClientModel: { getInstance: () => client } };
});
vi.mock("./onboarding-model", () => ({
    setClientMeta: vi.fn(async () => {}),
    OnboardingModel: { getInstance: () => ({ isActive: () => false, dismissTip: vi.fn() }) },
}));

const Meta = {
    "onboarding:featureversion": CurrentOnboardingVersion,
    "onboarding:featuretour": "active",
    "onboarding:featurestep": "output",
};
function setMeta(meta: MetaType) {
    globalStore.set(ClientModel.getInstance().clientAtom as ReturnType<typeof atom<Client>>, { meta } as Client);
}

beforeEach(() => {
    FeatureTourModel.resetInstance();
    vi.clearAllMocks();
    setMeta({});
    globalStore.set(atoms.staticTabId as ReturnType<typeof atom<string>>, "tab");
    vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(atom({ blockids: ["terminal"] } as Tab));
    vi.mocked(getFocusedBlockId).mockReturnValue("terminal");
});
afterEach(() => {
    FeatureTourModel.resetInstance();
    vi.unstubAllGlobals();
});

describe("feature tour lifecycle", () => {
    it("resumes dismissed progress and restarts completed or obsolete tours", () => {
        expect(savedFeatureStep({ ...Meta, "onboarding:featuretour": "dismissed" })).toBe("output");
        expect(savedFeatureStep({ ...Meta, "onboarding:featuretour": "done" })).toBe("history");
        expect(savedFeatureStep({ ...Meta, "onboarding:featureversion": "v1.3.0" })).toBe("history");
        expect(savedFeatureStep({ ...Meta, "onboarding:featurestep": "invalid" })).toBe("history");
    });
    it("resumes saved progress only when started and preserves progress on close", async () => {
        const model = FeatureTourModel.getInstance();
        setMeta(Meta);
        expect(globalStore.get(model.stepAtom)).toBeNull();
        model.start();
        expect(globalStore.get(model.stepAtom)).toBe("output");
        model.move(1);
        model.close();
        await Promise.resolve();
        expect(setClientMeta).toHaveBeenLastCalledWith(
            expect.objectContaining({ "onboarding:featurestep": "host", "onboarding:featuretour": "dismissed" })
        );
        expect(globalStore.get(model.stepAtom)).toBeNull();
    });
    it("finishes the last step and respects dismissal from another window", async () => {
        const model = FeatureTourModel.getInstance();
        model.start();
        model.setStep("files");
        model.move(1);
        expect(setClientMeta).toHaveBeenLastCalledWith(expect.objectContaining({ "onboarding:featuretour": "done" }));
        model.start();
        await Promise.resolve();
        await Promise.resolve();
        setMeta({ ...Meta, "onboarding:featuretour": "dismissed" });
        expect(globalStore.get(model.stepAtom)).toBeNull();
    });
});

describe("real feature actions", () => {
    function terminal() {
        const vm = {
            viewType: "term",
            blockId: "terminal",
            openCommandLibrary: vi.fn(),
            inspectCommandOutput: vi.fn(),
            outputSnapshotAtom: atom(null),
            getCommandLibraryContext: () => ({ connection: "gpu", cwd: "/srv/project" }),
        };
        vi.mocked(getBlockComponentModel).mockReturnValue({ viewModel: vm } as any);
        return vm;
    }
    it("opens history in an active-tab terminal without inserting commands", async () => {
        const vm = terminal();
        vi.mocked(getFocusedBlockId).mockReturnValue("background-terminal");
        await openFeatureTourTarget("history");
        expect(vm.openCommandLibrary.mock.calls).toEqual([[]]);
        expect(getBlockComponentModel).not.toHaveBeenCalledWith("background-terminal");
        expect(createBlock).not.toHaveBeenCalled();
    });
    it("shows actionable errors for missing terminals and output", async () => {
        vi.mocked(getBlockComponentModel).mockReturnValue(null);
        await expect(openFeatureTourTarget("history")).rejects.toThrow("Open a terminal");
        terminal();
        const model = FeatureTourModel.getInstance();
        model.setStep("output");
        await model.openTarget();
        expect(globalStore.get(model.errorAtom)).toContain("Run a command");
        expect(globalStore.get(model.openedAtom)).toBe(false);
    });
    it("opens Host and Files on the terminal's host and folder", async () => {
        terminal();
        await openFeatureTourTarget("host");
        await openFeatureTourTarget("files");
        expect(createBlock).toHaveBeenNthCalledWith(1, {
            meta: { view: "host", connection: "gpu", "host:tab": "ports" },
        });
        expect(createBlock).toHaveBeenNthCalledWith(2, {
            meta: { view: "preview", connection: "gpu", file: "/srv/project" },
        });
    });
});
