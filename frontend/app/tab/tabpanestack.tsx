// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { SingleView, TabCacheCeiling, tabCacheVersionAtom } from "@/app/store/activetab";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { tabCacheLimit, updateTabLru } from "@/app/store/tabpaneutils";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { TabContent } from "./tabcontent";

export function TabPaneStack({ noTopPadding }: { noTopPadding: boolean }) {
    const active = useAtomValue(atoms.staticTabId);
    const workspace = useAtomValue(atoms.workspace);
    const configuredLimit = useAtomValue(getSettingsKeyAtom("window:maxtabcachesize"));
    const limit = SingleView ? tabCacheLimit(configuredLimit ?? 10, TabCacheCeiling) : 1;
    const version = useAtomValue(tabCacheVersionAtom);
    const [cache, setCache] = useState({ version, ids: [] as string[] });
    const mounted = updateTabLru(cache.version === version ? cache.ids : [], active, workspace?.tabids ?? [], limit);
    if (version !== cache.version || mounted.join() !== cache.ids.join()) {
        setCache({ version, ids: mounted });
    }
    // Moving retained DOM subtrees can reset embedded webviews and browser-managed selection.
    const paneIds = [...mounted].sort();
    return (
        <div className="relative flex-1 min-w-0 h-full overflow-hidden">
            {paneIds.map((id) => (
                <div
                    key={id}
                    inert={id !== active}
                    aria-hidden={id !== active}
                    className="absolute inset-0 flex"
                    style={id === active ? undefined : { visibility: "hidden", left: "-200vw", right: "200vw" }}
                >
                    <ErrorBoundary>
                        <TabModelContext.Provider value={getTabModelByTabId(id)}>
                            <TabContent tabId={id} noTopPadding={noTopPadding} />
                        </TabModelContext.Provider>
                    </ErrorBoundary>
                </div>
            ))}
        </div>
    );
}
