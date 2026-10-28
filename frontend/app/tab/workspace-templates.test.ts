// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FlexDirection, type LayoutNode } from "@/layout/lib/types";
import { describe, expect, it } from "vitest";
import {
    captureTemplateMeta,
    captureTemplateTab,
    instantiateTemplateLayout,
    readWorkspaceTemplates,
    resolveTemplateMeta,
} from "./workspace-templates";

describe("workspace template capture", () => {
    it("keeps navigation context without commands, environment, or session identity", () => {
        const meta = {
            view: "term",
            controller: "cmd",
            connection: "prod",
            "cmd:cwd": "/srv/api",
            cmd: "deploy",
            "cmd:env": { TOKEN: "secret" },
            "term:remotesessionid": "session",
        } as MetaType;
        expect(captureTemplateMeta(meta)).toEqual({
            view: "term",
            controller: "shell",
            connection: "prod",
            "cmd:cwd": "/srv/api",
        });
    });

    it("preserves proportions while replacing every block and layout identity", () => {
        const root: LayoutNode = {
            id: "old-root",
            size: 10,
            flexDirection: FlexDirection.Row,
            children: [
                { id: "old-a", size: 3, flexDirection: FlexDirection.Column, data: { blockId: "a" } },
                { id: "old-b", size: 7, flexDirection: FlexDirection.Column, data: { blockId: "b" } },
            ],
        };
        const template = captureTemplateTab("Investigate", root, [
            { oid: "a", meta: { view: "term", connection: "dev" } },
            { oid: "b", meta: { view: "preview", file: "/srv" } },
        ] as Block[]);
        let seq = 0;
        const restored = instantiateTemplateLayout(template.layout, ["new-a", "new-b"], () => `node-${++seq}`);
        expect(restored.children.map((child) => [child.id, child.size, child.data.blockId])).toEqual([
            ["node-2", 3, "new-a"],
            ["node-3", 7, "new-b"],
        ]);
        expect(JSON.stringify(template)).not.toContain("old-");
        expect(root.children[0].data.blockId).toBe("a");
    });

    it("applies launch destinations and sanitizes metadata again", () => {
        expect(
            resolveTemplateMeta(
                { view: "term", connection: "prod", "cmd:cwd": "/old", cmd: "rm -rf x" } as MetaType,
                "staging",
                "/srv/new"
            )
        ).toEqual({ view: "term", controller: "shell", connection: "staging", "cmd:cwd": "/srv/new" });
        expect(resolveTemplateMeta({ view: "preview", file: "/old" }, "", "/tmp")).toEqual({
            view: "preview",
            file: "/tmp",
            connection: undefined,
        });
    });
    it("preserves each pane's host and folder unless explicitly overridden", () => {
        const panes: MetaType[] = [
            { view: "term", connection: "prod", "cmd:cwd": "/srv/api" },
            { view: "term", connection: "staging", "cmd:cwd": "/srv/worker" },
            { view: "preview", file: "/local/logs" },
        ];
        expect(panes.map((meta) => resolveTemplateMeta(meta))).toEqual(panes.map(captureTemplateMeta));
        expect(resolveTemplateMeta(panes[0], "").connection).toBeUndefined();
        expect(resolveTemplateMeta(panes[1], undefined, "/new")).toMatchObject({
            connection: "staging",
            "cmd:cwd": "/new",
        });
        expect(resolveTemplateMeta(panes[1], "dev")).toMatchObject({
            connection: "dev",
            "cmd:cwd": "/srv/worker",
        });
    });
    it("does not capture credentials embedded in browser URLs", () => {
        expect(
            captureTemplateMeta({ view: "web", url: "https://user:secret@example.com/logs?token=secret#auth" }).url
        ).toBe("https://example.com/logs");
    });
    it("ignores malformed saved entries without hiding valid setups", () => {
        expect(
            readWorkspaceTemplates({
                "workspace:template:bad": { version: 1, id: "bad", name: "Bad", tabs: [null] },
                "other:key": "unrelated",
            } as unknown as MetaType)
        ).toEqual([]);
    });
});
