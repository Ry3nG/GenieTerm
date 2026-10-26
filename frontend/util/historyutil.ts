// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as util from "@/util/util";

const MaxHistory = 20;

// Windows navigation must stop at drive and network-share roots.
function getParentDirectory(path: string): string {
    if (util.isBlank(path)) {
        // this not great, ideally we'd never be passed a null path
        return "/";
    }
    if (path == "/") {
        return "/";
    }
    const windowsRoot = path.match(/^[A-Za-z]:[\\/]|^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/)?.[0];
    if (windowsRoot) {
        const separator = windowsRoot.includes("\\") ? "\\" : "/";
        const root = windowsRoot.replace(/[\\/]+$/, "") + separator;
        const trimmedPath = path.replace(/[\\/]+$/, "");
        const lastSeparator = Math.max(trimmedPath.lastIndexOf("/"), trimmedPath.lastIndexOf("\\"));
        if (lastSeparator < root.length) {
            return path.length <= root.length ? path : root;
        }
        return trimmedPath.slice(0, lastSeparator);
    }
    const splitPath = path.split("/");
    splitPath.pop();
    if (splitPath.length == 1 && splitPath[0] == "") {
        return "/";
    }
    const newPath = splitPath.join("/");
    return newPath;
}

function goHistoryBack(curValKey: "url" | "file", curVal: string, meta: MetaType, backToParent: boolean): MetaType {
    const rtnMeta: MetaType = {};
    const history = (meta?.history ?? []).slice();
    const historyForward = (meta?.["history:forward"] ?? []).slice();
    if (history == null || history.length == 0) {
        if (backToParent) {
            const parentDir = getParentDirectory(curVal);
            if (parentDir == curVal) {
                return null;
            }
            historyForward.unshift(curVal);
            while (historyForward.length > MaxHistory) {
                historyForward.pop();
            }
            return { [curValKey]: parentDir, "history:forward": historyForward };
        } else {
            return null;
        }
    }
    const lastVal = history.pop();
    historyForward.unshift(curVal);
    return { [curValKey]: lastVal, history: history, "history:forward": historyForward };
}

function goHistoryForward(curValKey: "url" | "file", curVal: string, meta: MetaType): MetaType {
    const rtnMeta: MetaType = {};
    let history = (meta?.history ?? []).slice();
    const historyForward = (meta?.["history:forward"] ?? []).slice();
    if (historyForward == null || historyForward.length == 0) {
        return null;
    }
    const lastVal = historyForward.shift();
    history.push(curVal);
    if (history.length > MaxHistory) {
        history.shift();
    }
    return { [curValKey]: lastVal, history: history, "history:forward": historyForward };
}

function goHistory(curValKey: "url" | "file", curVal: string, newVal: string, meta: MetaType): MetaType {
    const rtnMeta: MetaType = {};
    const history = (meta?.history ?? []).slice();
    history.push(curVal);
    if (history.length > MaxHistory) {
        history.shift();
    }
    return { [curValKey]: newVal, history: history, "history:forward": [] };
}

export { getParentDirectory, goHistory, goHistoryBack, goHistoryForward };
