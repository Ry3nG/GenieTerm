// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { parseTransferPath } from "@/util/transferutil";
import { isLocalConnName } from "@/util/util";
import { quoteForPosixShell } from "./termutil";

type TerminalDropContext = {
    terminalConnection?: string;
    terminalLastCommand?: string;
    terminalShellIntegrationStatus?: string;
};

export function getDraggedFileTerminalPath(draggedFile: DraggedFile, context: TerminalDropContext = {}): string {
    if (!draggedFile) {
        return "";
    }
    const parsedUri = parseDraggedFileUri(draggedFile.uri);
    if (parsedUri?.kind === "remote" && shouldPasteRemoteUri(parsedUri.connection, context)) {
        return draggedFile.uri;
    }
    if (draggedFile.path) {
        return draggedFile.path;
    }
    if (parsedUri) {
        return parsedUri.path;
    }
    if (draggedFile.uri) {
        return draggedFile.uri;
    }
    if (draggedFile.absParent && draggedFile.relName) {
        return joinRemotePath(draggedFile.absParent, draggedFile.relName);
    }
    return "";
}

export function formatDraggedFileTerminalPaste(draggedFile: DraggedFile, context: TerminalDropContext = {}): string {
    const filePath = getDraggedFileTerminalPath(draggedFile, context);
    if (!filePath) {
        return "";
    }
    return `${quoteForTerminalPaste(filePath)} `;
}

function parseDraggedFileUri(uri: string): ReturnType<typeof parseTransferPath> | null {
    if (!uri) {
        return null;
    }
    try {
        return parseTransferPath(uri);
    } catch {
        return null;
    }
}

function shouldPasteRemoteUri(fileConnection: string, context: TerminalDropContext): boolean {
    if (isRunningManualSshToConnection(context, fileConnection)) {
        return false;
    }
    if (context.terminalConnection == null) {
        return false;
    }
    if (isLocalConnName(fileConnection) && isLocalConnName(context.terminalConnection)) {
        return false;
    }
    return fileConnection !== context.terminalConnection;
}

function isRunningManualSshToConnection(context: TerminalDropContext, fileConnection: string): boolean {
    if (context.terminalShellIntegrationStatus !== "running-command") {
        return false;
    }
    const sshTarget = getManualSshTarget(context.terminalLastCommand);
    if (!sshTarget) {
        return false;
    }
    return connectionTargetMatches(fileConnection, sshTarget);
}

function getManualSshTarget(lastCommand: string): string {
    const words = lastCommand?.trim().split(/\s+/) ?? [];
    if (words.length < 2) {
        return "";
    }
    let idx = 0;
    while (idx < words.length && ["sudo", "doas", "env", "time", "nice", "nohup", "sshpass"].includes(words[idx])) {
        idx++;
    }
    const command = words[idx]?.split("/").pop();
    if (command !== "ssh" && command !== "mosh") {
        return "";
    }
    idx++;
    let targetUser = "";
    let targetPort = "";
    while (idx < words.length) {
        const word = words[idx];
        if (word === "--") {
            idx++;
            break;
        }
        if (word === "-l") {
            targetUser = words[idx + 1] ?? "";
            idx += 2;
            continue;
        }
        if (word.startsWith("-l") && word.length > 2) {
            targetUser = word.slice(2);
            idx++;
            continue;
        }
        if (word === "-p") {
            targetPort = words[idx + 1] ?? "";
            idx += 2;
            continue;
        }
        if (word.startsWith("-p") && word.length > 2) {
            targetPort = word.slice(2);
            idx++;
            continue;
        }
        if (word.startsWith("-")) {
            idx += optionConsumesNextArg(word) ? 2 : 1;
            continue;
        }
        break;
    }
    const host = words[idx] ?? "";
    if (!host) {
        return "";
    }
    const withUser = targetUser && !host.includes("@") ? `${targetUser}@${host}` : host;
    if (!targetPort || withUser.includes(":")) {
        return withUser;
    }
    return `${withUser}:${targetPort}`;
}

function optionConsumesNextArg(option: string): boolean {
    return ["-b", "-c", "-D", "-E", "-F", "-I", "-i", "-J", "-L", "-m", "-O", "-o", "-Q", "-R", "-S", "-W", "-w"].includes(
        option
    );
}

function connectionTargetMatches(connection: string, target: string): boolean {
    const connectionIdentity = parseConnectionIdentity(connection);
    const targetIdentity = parseConnectionIdentity(target);
    if (!connectionIdentity.host || !targetIdentity.host) {
        return connection === target;
    }
    if (connectionIdentity.host !== targetIdentity.host) {
        return false;
    }
    if (connectionIdentity.user && targetIdentity.user && connectionIdentity.user !== targetIdentity.user) {
        return false;
    }
    if (connectionIdentity.port && targetIdentity.port && connectionIdentity.port !== targetIdentity.port) {
        return false;
    }
    return true;
}

function parseConnectionIdentity(value: string): { user: string; host: string; port: string } {
    const atIdx = value.lastIndexOf("@");
    const user = atIdx >= 0 ? value.slice(0, atIdx) : "";
    let host = atIdx >= 0 ? value.slice(atIdx + 1) : value;
    let port = "";
    const portMatch = host.match(/^(.+):(\d+)$/);
    if (portMatch && !portMatch[1].includes(":")) {
        host = portMatch[1];
        port = portMatch[2];
    }
    return { user, host, port };
}

function quoteForTerminalPaste(filePath: string): string {
    if (filePath === "~") {
        return "~";
    }
    if (!filePath.startsWith("~/")) {
        return quoteForPosixShell(filePath);
    }
    const homePath = filePath.slice(2);
    if (!needsPosixShellQuoting(homePath)) {
        return filePath;
    }
    return `~/${quoteForPosixShell(homePath)}`;
}

function needsPosixShellQuoting(value: string): boolean {
    return !/^[A-Za-z0-9_@%+=:,./-]*$/.test(value);
}

function joinRemotePath(parent: string, child: string): string {
    if (parent.endsWith("/")) {
        return `${parent}${child}`;
    }
    return `${parent}/${child}`;
}
