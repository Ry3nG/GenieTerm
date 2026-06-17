import { describe, expect, it } from "vitest";

import {
    buildRsyncFolderArgs,
    ensureTrailingSlash,
    getRemotePathBaseName,
    parseWshRemoteUri,
} from "./transferutil";

describe("transferutil", () => {
    it("parses home-relative wsh remote URIs", () => {
        expect(parseWshRemoteUri("wsh://paw-5090-ws/~/projects/out")).toEqual({
            connection: "paw-5090-ws",
            remotePath: "~/projects/out",
        });
    });

    it("parses absolute wsh remote URIs", () => {
        expect(parseWshRemoteUri("wsh://server//var/log/app")).toEqual({
            connection: "server",
            remotePath: "/var/log/app",
        });
    });

    it("decodes encoded connection and path components", () => {
        expect(parseWshRemoteUri("wsh://host%20alias/%7E/project%20data")).toEqual({
            connection: "host alias",
            remotePath: "~/project data",
        });
    });

    it("rejects local and malformed remote URIs", () => {
        expect(() => parseWshRemoteUri("/tmp/file")).toThrow("Folder download only supports remote wsh:// paths");
        expect(() => parseWshRemoteUri("wsh://local/~/file")).toThrow("Folder download requires a remote connection");
        expect(() => parseWshRemoteUri("wsh://missing-path")).toThrow("Invalid remote path");
    });

    it("normalizes trailing slashes", () => {
        expect(ensureTrailingSlash("/tmp/out")).toBe("/tmp/out/");
        expect(ensureTrailingSlash("/tmp/out/")).toBe("/tmp/out/");
    });

    it("gets stable folder names from remote paths", () => {
        expect(getRemotePathBaseName("~/projects/out/")).toBe("out");
        expect(getRemotePathBaseName("/var/log/app")).toBe("app");
        expect(getRemotePathBaseName("~")).toBe("download");
    });

    it("builds rsync folder args with trailing source and destination slashes", () => {
        expect(buildRsyncFolderArgs("wsh://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out")).toEqual([
            "-az",
            "paw-5090-ws:~/projects/out/",
            "/Users/me/Desktop/out/",
        ]);
    });
});
