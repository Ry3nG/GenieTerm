// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0s

import base64 from "base64-js";
import clsx, { type ClassValue } from "clsx";
import { Atom, atom, Getter, SetStateAction, Setter, useAtomValue } from "jotai";
import { twMerge } from "tailwind-merge";
import { throttle } from "throttle-debounce";
const prevValueCache = new WeakMap<any, any>(); // stores a previous value for a deep equal comparison (used with the deepCompareReturnPrev function)

function isBlank(str: string): boolean {
    return str == null || str == "";
}

function isLocalConnName(connName: string): boolean {
    if (isBlank(connName)) {
        return true;
    }
    return connName === "local" || connName.startsWith("local:");
}

function isWslConnName(connName: string): boolean {
    return connName != null && connName.startsWith("wsl://");
}

function isSshConnName(connName: string): boolean {
    return !isLocalConnName(connName) && !isWslConnName(connName);
}

function base64ToString(b64: string): string {
    if (b64 == null) {
        return null;
    }
    if (b64 == "") {
        return "";
    }
    const stringBytes = base64.toByteArray(b64);
    return new TextDecoder().decode(stringBytes);
}

function stringToBase64(input: string): string {
    const stringBytes = new TextEncoder().encode(input);
    return base64.fromByteArray(stringBytes);
}

function arrayToBase64(input: Uint8Array): string {
    return base64.fromByteArray(input);
}

function base64ToArray(b64: string): Uint8Array<ArrayBufferLike> {
    const cleanB64 = b64.replace(/\s+/g, "");
    return base64.toByteArray(cleanB64);
}

function boundNumber(num: number, min: number, max: number): number {
    if (num == null || typeof num != "number" || isNaN(num)) {
        return null;
    }
    return Math.min(Math.max(num, min), max);
}

// key must be a suitable weakmap key.  pass the new value
// it will return the prevValue (for object equality) if the new value is deep equal to the prev value
function deepCompareReturnPrev(key: any, newValue: any): any {
    if (key == null) {
        return newValue;
    }
    const previousValue = prevValueCache.get(key);
    if (previousValue !== undefined && JSON.stringify(newValue) === JSON.stringify(previousValue)) {
        return previousValue;
    }
    prevValueCache.set(key, newValue);
    return newValue;
}

function makeIconClass(icon: string, fw: boolean, opts?: { spin?: boolean; defaultIcon?: string }): string {
    if (isBlank(icon)) {
        if (opts?.defaultIcon != null) {
            return makeIconClass(opts.defaultIcon, fw, { spin: opts?.spin });
        }
        return null;
    }

    let animation: string | null = null;
    let hasFwModifier = false;

    while (icon.match(/\+(spin|beat|fade|fw)$/)) {
        const modifierMatch = icon.match(/\+(spin|beat|fade|fw)$/);
        if (modifierMatch) {
            const modifier = modifierMatch[1];
            if (modifier === "fw") {
                hasFwModifier = true;
            } else {
                animation = modifier;
            }
            icon = icon.replace(/\+(spin|beat|fade|fw)$/, "");
        }
    }

    let baseClass: string;
    if (icon.match(/^(solid@)?[a-z0-9-]+$/)) {
        icon = icon.replace(/^solid@/, "");
        baseClass = `fa fa-solid fa-${icon}`;
    } else if (icon.match(/^regular@[a-z0-9-]+$/)) {
        icon = icon.replace(/^regular@/, "");
        baseClass = `fa fa-sharp fa-regular fa-${icon}`;
    } else if (icon.match(/^brands@[a-z0-9-]+$/)) {
        icon = icon.replace(/^brands@/, "");
        baseClass = `fa fa-brands fa-${icon}`;
    } else if (icon.match(/^custom@[a-z0-9-]+$/)) {
        icon = icon.replace(/^custom@/, "");
        baseClass = `fa fa-kit fa-${icon}`;
    } else {
        if (opts?.defaultIcon != null) {
            return makeIconClass(opts.defaultIcon, fw, { spin: opts?.spin });
        }
        return null;
    }

    const shouldAddFw = fw || hasFwModifier;
    const hasSpin = animation === "spin" || opts?.spin;
    const animationClass = animation && animation !== "spin" ? `fa-${animation}` : null;

    return clsx(baseClass, shouldAddFw ? "fa-fw" : null, hasSpin ? "fa-spin" : null, animationClass);
}

/**
 * A wrapper function for running a promise and catching any errors
 * @param f The promise to run
 */
function fireAndForget(f: () => Promise<any>) {
    f()?.catch((e) => {
        console.log("fireAndForget error", e);
    });
}

function jotaiLoadableValue<T>(value: Loadable<T>, def: T): T {
    if (value.state === "hasData") {
        return value.data;
    }
    return def;
}

const NullAtom = atom(null);

function useAtomValueSafe<T>(atom: Atom<T> | Atom<Promise<T>>): T {
    if (atom == null) {
        return useAtomValue(NullAtom) as T;
    }
    return useAtomValue(atom);
}

/**
 * Simple wrapper function that lazily evaluates the provided function and caches its result for future calls.
 * @param callback The function to lazily run.
 * @returns The result of the function.
 */
const lazy = <T extends (...args: any[]) => any>(callback: T) => {
    let res: ReturnType<T>;
    let processed = false;
    return (...args: Parameters<T>): ReturnType<T> => {
        if (processed) return res;
        res = callback(...args);
        processed = true;
        return res;
    };
};

function atomWithThrottle<T>(initialValue: T, delayMilliseconds = 500): AtomWithThrottle<T> {
    // DO NOT EXPORT currentValueAtom as using this atom to set state can cause
    // inconsistent state between currentValueAtom and throttledValueAtom
    const _currentValueAtom = atom(initialValue);

    const throttledValueAtom = atom(initialValue, (get, set, update: SetStateAction<T>) => {
        const prevValue = get(_currentValueAtom);
        const nextValue = typeof update === "function" ? (update as (prev: T) => T)(prevValue) : update;
        set(_currentValueAtom, nextValue);
        throttleUpdate(get, set);
    });

    const throttleUpdate = throttle(delayMilliseconds, (get: Getter, set: Setter) => {
        const curVal = get(_currentValueAtom);
        set(throttledValueAtom, curVal);
    });

    return {
        currentValueAtom: atom((get) => get(_currentValueAtom)),
        throttledValueAtom,
    };
}

function getPrefixedSettings(settings: SettingsType, prefix: string): SettingsType {
    const rtn: SettingsType = {};
    if (settings == null || isBlank(prefix)) {
        return rtn;
    }
    for (const key in settings) {
        if (key == prefix || key.startsWith(prefix + ":")) {
            rtn[key] = settings[key];
        }
    }
    return rtn;
}

function countGraphemes(str: string): number {
    if (str == null) {
        return 0;
    }
    // this exists (need to hack TS to get it to not show an error)
    const seg = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(seg.segment(str)).length;
}

function makeConnRoute(conn: string): string {
    if (isBlank(conn)) {
        return "conn:local";
    }
    return "conn:" + conn;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

type ParsedDataUrl = {
    mimeType: string;
    buffer: Uint8Array;
};

function parseDataUrl(dataUrl: string): ParsedDataUrl {
    if (!dataUrl.startsWith("data:")) throw new Error("Invalid data URL");
    const [header, data] = dataUrl.split(",", 2);
    if (data === undefined) throw new Error("Invalid data URL: missing data");

    const meta = header.slice(5);
    let mimeType = "text/plain;charset=US-ASCII";
    const parts = meta.split(";");
    if (parts[0]) mimeType = parts[0];
    const isBase64 = parts.some((p) => p.toLowerCase() === "base64");

    let buffer: Uint8Array;
    if (isBase64) {
        buffer = base64ToArray(data);
    } else {
        // assume text
        const decoded = decodeURIComponent(data);
        buffer = new TextEncoder().encode(decoded);
    }

    return { mimeType, buffer };
}

/**
 * Sort objects by display:order (ascending) and display:name (alphabetically)
 * @param a First object to compare
 * @param b Second object to compare
 * @returns Comparison result for Array.sort()
 */
function sortByDisplayOrder<T extends { "display:order"?: number; "display:name"?: string }>(a: T, b: T): number {
    const orderDiff = (a["display:order"] || 0) - (b["display:order"] || 0);
    if (orderDiff !== 0) return orderDiff;
    return (a["display:name"] || "").localeCompare(b["display:name"] || "");
}

export {
    arrayToBase64,
    atomWithThrottle,
    base64ToArray,
    base64ToString,
    boundNumber,
    cn,
    countGraphemes,
    deepCompareReturnPrev,
    fireAndForget,
    getPrefixedSettings,
    isBlank,
    isLocalConnName,
    isSshConnName,
    isWslConnName,
    jotaiLoadableValue,
    lazy,
    makeConnRoute,
    makeIconClass,
    NullAtom,
    parseDataUrl,
    sleep,
    sortByDisplayOrder,
    stringToBase64,
    useAtomValueSafe,
};
