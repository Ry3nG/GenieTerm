import { describe, expect, it } from "vitest";

import {
    buildRsyncFolderArgs,
    ensureTrailingSlash,
    getRemotePathBaseName,
    parseTransferPath,
    parseWshRemoteUri,
    toPublicRemoteUri,
} from "./transferutil";

describe("transferutil", () => {
    it("parses home-relative wsh remote URIs", () => {
        expect(parseWshRemoteUri("wsh://paw-5090-ws/~/projects/out")).toEqual({
            scheme: "wsh",
            connection: "paw-5090-ws",
            remotePath: "~/projects/out",
        });
    });

    it("parses genie remote URI aliases", () => {
        expect(parseWshRemoteUri("genie://paw-5090-ws/~/projects/out")).toEqual({
            scheme: "genie",
            connection: "paw-5090-ws",
            remotePath: "~/projects/out",
        });
    });

    it("parses absolute wsh remote URIs", () => {
        expect(parseWshRemoteUri("wsh://server//var/log/app")).toEqual({
            scheme: "wsh",
            connection: "server",
            remotePath: "/var/log/app",
        });
    });

    it("decodes encoded connection and path components", () => {
        expect(parseWshRemoteUri("wsh://host%20alias/%7E/project%20data")).toEqual({
            scheme: "wsh",
            connection: "host alias",
            remotePath: "~/project data",
        });
    });

    it("rejects local and malformed remote URIs", () => {
        expect(() => parseWshRemoteUri("/tmp/file")).toThrow("remote genie:// or wsh:// paths");
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
        expect(buildRsyncFolderArgs("genie://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out")).toEqual([
            "-az",
            "paw-5090-ws:~/projects/out/",
            "/Users/me/Desktop/out/",
        ]);
    });

    it("parses remote and local transfer paths with stable basenames", () => {
        expect(parseTransferPath("wsh://paw-5090-ws/~/projects/out/")).toEqual({
            kind: "remote",
            uri: "wsh://paw-5090-ws/~/projects/out/",
            connection: "paw-5090-ws",
            path: "~/projects/out/",
            basename: "out",
        });
        expect(parseTransferPath("genie://paw-5090-ws/~/projects/out/")).toEqual({
            kind: "remote",
            uri: "genie://paw-5090-ws/~/projects/out/",
            connection: "paw-5090-ws",
            path: "~/projects/out/",
            basename: "out",
        });
        expect(parseTransferPath("file:///tmp/output%20dir")).toEqual({
            kind: "local",
            uri: "file:///tmp/output%20dir",
            path: "/tmp/output dir",
            basename: "output dir",
        });
        expect(parseTransferPath("/tmp/output dir/")).toEqual({
            kind: "local",
            uri: "file:///tmp/output%20dir/",
            path: "/tmp/output dir/",
            basename: "output dir",
        });
    });

    it("converts compatible remote URIs to public genie aliases", () => {
        expect(toPublicRemoteUri("wsh://paw-5090-ws/~/projects/out")).toBe("genie://paw-5090-ws/~/projects/out");
        expect(toPublicRemoteUri("genie://paw-5090-ws/~/projects/out")).toBe("genie://paw-5090-ws/~/projects/out");
    });
});
