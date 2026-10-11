// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";

export type LocalUrl = {
    url: string;
    protocol: "http:" | "https:";
    remoteHost: string;
    port: number;
    // path, query and hash, kept so tokens (Jupyter) and routes survive the forward
    rest: string;
};

export type ForwardOfferStatus = "offer" | "busy" | "forwarded" | "error";

export type ForwardOffer = {
    key: string;
    connName: string;
    url: LocalUrl;
    blockId: number | null;
    status: ForwardOfferStatus;
    localPort?: number;
    error?: string;
};

export type TermForwardHost = {
    getConnName(): string;
    offerEnabled(): boolean;
    // undefined when the shell reports no command state (no shell integration)
    getRunningCmdBlockId(): number | null | undefined;
    startForward(data: CommandPortForwardStartData): Promise<PortForwardInfo>;
    listForwards(connName: string): Promise<PortForwardInfo[]>;
    openUrl(url: string): void;
};

// Terminal output is full of control characters, and these patterns have to match them.
const LocalUrlPattern =
    // eslint-disable-next-line no-control-regex
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{1,5})?(?:[/?#][^\s"'<>`\\\x00-\x1f\x7f]*)?/gi;
// eslint-disable-next-line no-control-regex
const AnsiPattern = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]/g;
const TrailingPunctuation = /[.,;:!?)\]}'"]+$/;
const ScanTailBytes = 512;
// Only output from a command that is still running a moment later counts: servers keep
// running, while `cat config.yaml` printing a localhost URL exits right away.
const OfferDelayMs = 900;
const ForwardedHideMs = 8000;

function isSshConn(connName: string): boolean {
    return !!connName && connName !== "local" && !connName.startsWith("local:") && !connName.startsWith("wsl://");
}

export function parseLocalUrl(raw: string): LocalUrl | null {
    const text = raw.replace(TrailingPunctuation, "");
    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
    }
    const host = parsed.hostname.toLowerCase();
    let remoteHost: string;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::]") {
        remoteHost = "127.0.0.1";
    } else if (host === "[::1]") {
        remoteHost = "::1";
    } else {
        return null;
    }
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
    }
    return {
        url: text,
        protocol: parsed.protocol,
        remoteHost,
        port,
        rest: parsed.pathname + parsed.search + parsed.hash,
    };
}

export function findLocalUrls(text: string): { url: LocalUrl; end: number }[] {
    const result: { url: LocalUrl; end: number }[] = [];
    for (const match of text.matchAll(LocalUrlPattern)) {
        const url = parseLocalUrl(match[0]);
        if (url != null) {
            result.push({ url, end: match.index + match[0].length });
        }
    }
    return result;
}

export function makeLocalForwardUrl(url: LocalUrl, localPort: number): string {
    return `${url.protocol}//localhost:${localPort}${url.rest}`;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    if (a.length === 0) {
        return b;
    }
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function lastSchemeSeparator(data: Uint8Array): number {
    let idx = data.lastIndexOf(0x3a);
    while (idx >= 0) {
        if (data[idx + 1] === 0x2f && data[idx + 2] === 0x2f) {
            return idx;
        }
        idx = idx === 0 ? -1 : data.lastIndexOf(0x3a, idx - 1);
    }
    return -1;
}

// Scans raw pty output for URLs that point at the remote machine's own loopback. It decodes
// only chunks that contain "://", so heavy output (training logs, builds) costs one native
// byte search per chunk.
export class LocalUrlScanner {
    tail: Uint8Array = new Uint8Array(0);
    pending = false;
    decoder = new TextDecoder("utf-8", { fatal: false });

    feed(data: Uint8Array): LocalUrl[] {
        if (data.length === 0) {
            return [];
        }
        const prevTail = this.tail;
        this.tail =
            data.length >= ScanTailBytes
                ? data.slice(data.length - ScanTailBytes)
                : concatBytes(prevTail, data).slice(-ScanTailBytes);
        const scan =
            this.pending ||
            lastSchemeSeparator(data) >= 0 ||
            lastSchemeSeparator(concatBytes(prevTail.subarray(-2), data.subarray(0, 2))) >= 0;
        if (!scan) {
            return [];
        }
        const window = concatBytes(prevTail, data);
        const text = this.decoder.decode(window).replace(AnsiPattern, "");
        const sep = lastSchemeSeparator(window);
        // "http://local" at the end of a chunk: the rest of the URL arrives with the next one
        this.pending = sep >= 0 && window.length - sep <= 64;
        const out: LocalUrl[] = [];
        for (const item of findLocalUrls(text)) {
            if (item.end >= text.length) {
                this.pending = true;
                continue;
            }
            out.push(item.url);
        }
        return out;
    }

    reset() {
        this.tail = new Uint8Array(0);
        this.pending = false;
    }
}

export class TermForwardModel {
    host: TermForwardHost;
    offerAtom = jotai.atom(null) as jotai.PrimitiveAtom<ForwardOffer>;
    // key → the command run it was dismissed for; null when the shell doesn't report
    // commands, which keeps that port quiet for the life of the terminal
    dismissed = new Map<string, number | null>();
    pendingTimer: ReturnType<typeof setTimeout> = null;
    hideTimer: ReturnType<typeof setTimeout> = null;
    epoch = 0;

    constructor(host: TermForwardHost) {
        this.host = host;
    }

    getOffer(): ForwardOffer {
        return globalStore.get(this.offerAtom);
    }

    noteUrls(urls: LocalUrl[]) {
        if (urls.length === 0) {
            return;
        }
        const connName = this.host.getConnName();
        if (!isSshConn(connName) || !this.host.offerEnabled()) {
            return;
        }
        const url = urls[urls.length - 1];
        const key = `${connName}|${url.remoteHost}|${url.port}`;
        const blockId = this.host.getRunningCmdBlockId();
        if (blockId === null || this.isDismissed(key, blockId)) {
            return;
        }
        const current = this.getOffer();
        if (current?.key === key) {
            if (current.status === "offer") {
                globalStore.set(this.offerAtom, { ...current, url });
            }
            return;
        }
        if (current != null && current.status === "busy") {
            return;
        }
        this.clearPending();
        const epoch = ++this.epoch;
        this.pendingTimer = setTimeout(() => {
            this.pendingTimer = null;
            if (epoch !== this.epoch || this.host.getRunningCmdBlockId() !== blockId) {
                return;
            }
            this.showOffer({ key, connName, url, blockId: blockId ?? null, status: "offer" });
        }, OfferDelayMs);
    }

    showOffer(offer: ForwardOffer) {
        this.clearHide();
        globalStore.set(this.offerAtom, offer);
        const epoch = this.epoch;
        fireAndForget(async () => {
            const forwards = await this.host.listForwards(offer.connName).catch((): PortForwardInfo[] => []);
            const existing = (forwards ?? []).find(
                (f) => f.remoteport === offer.url.port && f.remotehost === offer.url.remoteHost && f.status !== "error"
            );
            const current = this.getOffer();
            if (existing == null || epoch !== this.epoch || current?.key !== offer.key || current.status !== "offer") {
                return;
            }
            globalStore.set(this.offerAtom, { ...current, status: "forwarded", localPort: existing.localport });
        });
    }

    isDismissed(key: string, blockId: number | undefined): boolean {
        if (!this.dismissed.has(key)) {
            return false;
        }
        const dismissedFor = this.dismissed.get(key);
        return dismissedFor == null || dismissedFor === blockId;
    }

    // The command that printed the URL has exited, so whatever it served is gone. A forward
    // it left behind stays in Host.
    noteRunningCmdBlock(runningBlockId: number | null | undefined) {
        for (const [key, blockId] of this.dismissed) {
            if (blockId != null && blockId !== runningBlockId) {
                this.dismissed.delete(key);
            }
        }
        const offer = this.getOffer();
        if (offer == null || offer.blockId == null || offer.status === "busy") {
            return;
        }
        if (runningBlockId === offer.blockId) {
            return;
        }
        this.clear();
    }

    async open(): Promise<void> {
        const offer = this.getOffer();
        if (offer == null || offer.status === "busy") {
            return;
        }
        if (offer.status === "forwarded" && offer.localPort) {
            this.host.openUrl(makeLocalForwardUrl(offer.url, offer.localPort));
            this.scheduleHide(offer.key);
            return;
        }
        globalStore.set(this.offerAtom, { ...offer, status: "busy", error: null });
        try {
            const info = await this.host.startForward({
                connname: offer.connName,
                remotehost: offer.url.remoteHost,
                remoteport: offer.url.port,
                localport: 0,
            });
            if (this.getOffer()?.key !== offer.key) {
                return;
            }
            globalStore.set(this.offerAtom, { ...offer, status: "forwarded", localPort: info.localport, error: null });
            this.host.openUrl(makeLocalForwardUrl(offer.url, info.localport));
            this.scheduleHide(offer.key);
        } catch (e) {
            if (this.getOffer()?.key !== offer.key) {
                return;
            }
            globalStore.set(this.offerAtom, { ...offer, status: "error", error: errorText(e) });
        }
    }

    // Cmd-click on a loopback URL in an SSH terminal means the remote machine's port, not this one's.
    openLink(raw: string): boolean {
        const connName = this.host.getConnName();
        if (!isSshConn(connName)) {
            return false;
        }
        const url = parseLocalUrl(raw);
        if (url == null) {
            return false;
        }
        fireAndForget(async () => {
            try {
                const info = await this.host.startForward({
                    connname: connName,
                    remotehost: url.remoteHost,
                    remoteport: url.port,
                    localport: 0,
                });
                this.host.openUrl(makeLocalForwardUrl(url, info.localport));
            } catch (e) {
                const key = `${connName}|${url.remoteHost}|${url.port}`;
                this.clearPending();
                globalStore.set(this.offerAtom, {
                    key,
                    connName,
                    url,
                    blockId: null,
                    status: "error",
                    error: errorText(e),
                });
            }
        });
        return true;
    }

    dismiss() {
        const offer = this.getOffer();
        if (offer != null) {
            this.dismissed.set(offer.key, offer.blockId);
        }
        this.clear();
    }

    scheduleHide(key: string) {
        this.clearHide();
        this.hideTimer = setTimeout(() => {
            this.hideTimer = null;
            const offer = this.getOffer();
            if (offer?.key === key) {
                this.dismissed.set(key, offer.blockId);
                this.clear();
            }
        }, ForwardedHideMs);
    }

    holdHide() {
        this.clearHide();
    }

    resumeHide() {
        const offer = this.getOffer();
        if (offer?.status === "forwarded" && this.hideTimer == null && !this.dismissed.has(offer.key)) {
            this.scheduleHide(offer.key);
        }
    }

    clear() {
        this.epoch++;
        this.clearPending();
        this.clearHide();
        globalStore.set(this.offerAtom, null);
    }

    clearPending() {
        if (this.pendingTimer != null) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
    }

    clearHide() {
        if (this.hideTimer != null) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    dispose() {
        this.clearPending();
        this.clearHide();
    }
}

function errorText(e: unknown): string {
    const text = e instanceof Error ? e.message : String(e ?? "");
    return text.replace(/^Error:\s*/, "") || "Couldn't forward the port";
}
