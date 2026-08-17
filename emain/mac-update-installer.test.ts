// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    getDownloadedUpdateSha512,
    getMacAppBundlePath,
    isDeveloperIdSignature,
    isMacCodeSignatureError,
} from "./mac-update-installer";

describe("mac-update-installer", () => {
    it("resolves the application bundle from its executable", () => {
        expect(getMacAppBundlePath("/Applications/GenieTerm.app/Contents/MacOS/GenieTerm")).toBe(
            "/Applications/GenieTerm.app"
        );
        expect(() => getMacAppBundlePath("/Applications/Other.app/Contents/MacOS/Other")).toThrow(
            "Unexpected macOS application path"
        );
    });

    it("recognizes Squirrel code signature failures", () => {
        expect(isMacCodeSignatureError("Error Domain=SQRLCodeSignatureErrorDomain Code=1")).toBe(true);
        expect(isMacCodeSignatureError("Code signature for GenieTerm.app did not pass validation")).toBe(true);
        expect(isMacCodeSignatureError("net::ERR_INTERNET_DISCONNECTED")).toBe(false);
    });

    it("selects the checksum for the architecture that was downloaded", () => {
        const update = {
            downloadedFile: "/cache/GenieTerm-darwin-arm64-0.4.83.zip",
            files: [
                { url: "GenieTerm-darwin-x64-0.4.83.zip", sha512: "x64-checksum" },
                { url: "GenieTerm-darwin-arm64-0.4.83.zip", sha512: "arm64-checksum" },
            ],
        };
        expect(getDownloadedUpdateSha512(update)).toBe("arm64-checksum");
    });

    it("requires a verified Developer ID signature", () => {
        const details = [
            "Authority=Developer ID Application: GenieTerm (ABC1234567)",
            "TeamIdentifier=ABC1234567",
        ].join("\n");
        expect(isDeveloperIdSignature(0, details)).toBe(true);
        expect(isDeveloperIdSignature(1, details)).toBe(false);
        expect(isDeveloperIdSignature(0, "Signature=adhoc\nTeamIdentifier=not set")).toBe(false);
    });
});
