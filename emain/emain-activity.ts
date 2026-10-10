// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let globalIsQuitting = false;
let globalIsStarting = true;
let globalIsRelaunching = false;
let forceQuit = false;
let userConfirmedQuit = false;

export function setGlobalIsQuitting(val: boolean) {
    globalIsQuitting = val;
}

export function getGlobalIsQuitting(): boolean {
    return globalIsQuitting;
}

export function setGlobalIsStarting(val: boolean) {
    globalIsStarting = val;
}

export function getGlobalIsStarting(): boolean {
    return globalIsStarting;
}

export function setGlobalIsRelaunching(val: boolean) {
    globalIsRelaunching = val;
}

export function getGlobalIsRelaunching(): boolean {
    return globalIsRelaunching;
}

export function setForceQuit(val: boolean) {
    forceQuit = val;
}

export function getForceQuit(): boolean {
    return forceQuit;
}

export function setUserConfirmedQuit(val: boolean) {
    userConfirmedQuit = val;
}

export function getUserConfirmedQuit(): boolean {
    return userConfirmedQuit;
}
