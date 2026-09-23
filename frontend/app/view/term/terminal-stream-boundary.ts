// Copyright 2026, GenieTerm. Apache-2.0.

type ParserState = "ground" | "escape" | "escape-intermediate" | "csi" | "osc" | "osc-escape" | "string" | "string-escape";

export class TerminalStreamBoundaryTracker {
    state: ParserState = "ground";
    utf8Remaining = 0;

    get isSafe(): boolean {
        return this.state === "ground" && this.utf8Remaining === 0;
    }

    reset(): void {
        this.state = "ground";
        this.utf8Remaining = 0;
    }

    feed(data: Uint8Array): void {
        for (const byte of data) {
            if (this.utf8Remaining > 0) {
                if (byte >= 0x80 && byte <= 0xbf) {
                    this.utf8Remaining--;
                    continue;
                }
                this.utf8Remaining = 0;
            }
            if (this.state !== "ground" && (byte === 0x18 || byte === 0x1a)) {
                this.state = "ground";
                continue;
            }
            if (this.state === "csi" && byte === 0x1b) {
                this.state = "escape";
                continue;
            }
            if (this.state === "ground") {
                if (byte === 0x1b) this.state = "escape";
                else if (byte === 0x9b) this.state = "csi";
                else if (byte === 0x9d) this.state = "osc";
                else if (byte === 0x90 || byte === 0x98 || byte === 0x9e || byte === 0x9f) this.state = "string";
                else if (byte >= 0xc2 && byte <= 0xdf) this.utf8Remaining = 1;
                else if (byte >= 0xe0 && byte <= 0xef) this.utf8Remaining = 2;
                else if (byte >= 0xf0 && byte <= 0xf4) this.utf8Remaining = 3;
            } else if (this.state === "escape") {
                if (byte === 0x5b) this.state = "csi";
                else if (byte === 0x5d) this.state = "osc";
                else if (byte === 0x50 || byte === 0x5f || byte === 0x5e || byte === 0x58) this.state = "string";
                else if (byte >= 0x20 && byte <= 0x2f) this.state = "escape-intermediate";
                else this.state = "ground";
            } else if (this.state === "escape-intermediate") {
                if (byte >= 0x30 && byte <= 0x7e) this.state = "ground";
            } else if (this.state === "csi") {
                if (byte >= 0x40 && byte <= 0x7e) this.state = "ground";
            } else if (this.state === "osc") {
                if (byte === 0x07) this.state = "ground";
                else if (byte === 0x1b) this.state = "osc-escape";
            } else if (this.state === "osc-escape") {
                if (byte === 0x5c) this.state = "ground";
                else if (byte !== 0x1b) this.state = "osc";
            } else if (this.state === "string") {
                if (byte === 0x1b) this.state = "string-escape";
            } else if (this.state === "string-escape") {
                if (byte === 0x5c) this.state = "ground";
                else if (byte !== 0x1b) this.state = "string";
            }
        }
    }
}
