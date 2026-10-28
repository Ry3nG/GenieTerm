// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { lazy, Suspense, useId, useState } from "react";

const WorkspaceTemplatePanel = lazy(() =>
    import("./workspace-template-panel").then((module) => ({ default: module.WorkspaceTemplatePanel }))
);

export function WorkspaceTemplateMenu({ workspace }: { workspace: Workspace }) {
    const [open, setOpen] = useState(false);
    const panelId = useId();
    return (
        <div className="w-full border-t border-border">
            <button
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted hover:text-foreground hover:bg-hoverbg cursor-pointer"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen(!open)}
            >
                <i className={open ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-right"} aria-hidden="true" />
                Saved setups
            </button>
            <div id={panelId}>
                {open && (
                    <Suspense
                        fallback={
                            <p role="status" className="px-3 py-2 text-xs text-muted">
                                Loading setups…
                            </p>
                        }
                    >
                        <WorkspaceTemplatePanel workspace={workspace} />
                    </Suspense>
                )}
            </div>
        </div>
    );
}
