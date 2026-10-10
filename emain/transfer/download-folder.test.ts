import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
    buildFolderDownloadPlan,
    buildFolderDownloadTransferJobInput,
    describeFolderTransferFailure,
    getRsyncPath,
    getUniqueDestinationPath,
    inspectFolderDestination,
    mapFolderDownloadError,
    parseOpenSshMajorVersion,
    parseRsyncMajorVersion,
} from "./download-folder";

describe("download-folder helpers", () => {
    it("builds a folder download plan", () => {
        expect(
            buildFolderDownloadPlan("wsh://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out", { platform: "darwin" })
        ).toEqual({
            folderName: "out",
            transport: "rsync",
            args: [
                "-az",
                "-e",
                "ssh -o BatchMode=yes -o ConnectTimeout=15",
                "--",
                "paw-5090-ws:projects/out/",
                "/Users/me/Desktop/out/",
            ],
        });
        expect(
            buildFolderDownloadPlan("genie://me@host:2222/~/My Docs", "/Users/me/Desktop/My Docs", {
                platform: "darwin",
                rsyncProtectArgs: true,
                connKeywords: { "ssh:identityfile": ["~/.ssh/id_work"] },
            }).args
        ).toEqual([
            "-az",
            "-e",
            "ssh -o BatchMode=yes -o ConnectTimeout=15 -p 2222 -i ~/.ssh/id_work",
            "-s",
            "--",
            "me@host:My Docs/",
            "/Users/me/Desktop/My Docs/",
        ]);
    });

    it("uses Windows OpenSSH without treating a drive letter as an scp host", () => {
        expect(
            buildFolderDownloadPlan("genie://paw-5090-ws/~/projects/out", "C:\\Users\\me\\Desktop\\out", {
                platform: "win32",
            })
        ).toEqual({
            folderName: "out",
            transport: "scp",
            args: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-r", "--", "paw-5090-ws:projects/out/.", "out"],
            cwd: "C:\\Users\\me\\Desktop",
        });
    });

    it("passes an explicit SSH port and connection settings to Windows scp", () => {
        expect(
            buildFolderDownloadPlan("genie://zrgong@server.example:2222/~/out", "C:\\Downloads\\out", {
                platform: "win32",
                connKeywords: { "ssh:proxyjump": ["bastion"] },
            }).args
        ).toEqual([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            "-P",
            "2222",
            "-J",
            "bastion",
            "-r",
            "--",
            "zrgong@server.example:out/.",
            "out",
        ]);
    });

    it("quotes scp remote paths for legacy scp and leaves them raw for SFTP-mode scp", () => {
        const legacy = buildFolderDownloadPlan("genie://host/~/My Docs", "C:\\Downloads\\My Docs", {
            platform: "win32",
        });
        expect(legacy.args.slice(-3)).toEqual(["--", "host:'My Docs/.'", "My Docs"]);
        const sftp = buildFolderDownloadPlan("genie://host/~/My Docs", "C:\\Downloads\\My Docs", {
            platform: "win32",
            scpUsesSftp: true,
        });
        expect(sftp.args.slice(-3)).toEqual(["--", "host:My Docs/.", "My Docs"]);
    });

    it("refuses WSL and option-like connections", () => {
        expect(() =>
            buildFolderDownloadPlan("genie://wsl://Ubuntu//home/u/x", "/tmp/x", { platform: "darwin" })
        ).toThrow("not available for WSL");
        expect(() => buildFolderDownloadPlan("genie://-oProxyCommand=x/~/out", "/tmp/out")).toThrow(
            "Unsupported SSH connection name"
        );
    });

    it("detects rsync and OpenSSH versions", () => {
        expect(parseRsyncMajorVersion("openrsync: protocol version 29\nrsync version 2.6.9 compatible")).toBe(2);
        expect(parseRsyncMajorVersion("rsync  version 3.4.1  protocol version 32")).toBe(3);
        expect(parseRsyncMajorVersion("")).toBeNull();
        expect(parseOpenSshMajorVersion("OpenSSH_for_Windows_8.1p1, LibreSSL 3.0.2")).toBe(8);
        expect(parseOpenSshMajorVersion("OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2")).toBe(9);
        expect(parseOpenSshMajorVersion("OpenSSH_9.8p1, LibreSSL 3.3.6")).toBe(9);
        expect(parseOpenSshMajorVersion("garbage")).toBeNull();
    });

    it("adds actionable hints for batch-mode SSH authentication failures", () => {
        const detail = describeFolderTransferFailure("me@host: Permission denied (publickey,password).", {
            "ssh:passwordsecretname": "host-password",
        });
        expect(detail).toContain("Permission denied");
        expect(detail).toContain("ssh-agent");
        expect(detail).toContain("password saved in GenieTerm");
        expect(describeFolderTransferFailure("Host key verification failed.")).toContain("accept its host key");
        expect(describeFolderTransferFailure("No such file or directory")).toBe("No such file or directory");
    });

    it("detects existing destinations and picks a unique sibling name", () => {
        const dir = fs.mkdtempSync(path.join(tmpdir(), "genieterm-folder-dest-"));
        try {
            const target = path.join(dir, "out");
            expect(inspectFolderDestination(target)).toBe("missing");
            fs.mkdirSync(target);
            expect(inspectFolderDestination(target)).toBe("empty-folder");
            fs.writeFileSync(path.join(target, "a.txt"), "a");
            expect(inspectFolderDestination(target)).toBe("non-empty-folder");
            fs.writeFileSync(path.join(dir, "file"), "x");
            expect(inspectFolderDestination(path.join(dir, "file"))).toBe("not-folder");
            expect(getUniqueDestinationPath(target)).toBe(path.join(dir, "out (1)"));
            fs.mkdirSync(path.join(dir, "out (1)"));
            expect(getUniqueDestinationPath(target)).toBe(path.join(dir, "out (2)"));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("selects the first existing rsync candidate", () => {
        const selected = getRsyncPath((candidate) => candidate === "/usr/local/bin/rsync");
        expect(selected).toBe("/usr/local/bin/rsync");
    });

    it("falls back to PATH rsync when no known absolute path exists", () => {
        const selected = getRsyncPath(() => false);
        expect(selected).toBe("rsync");
    });

    it("builds a queued transfer job for folder downloads after destination selection", () => {
        const destinationPath = path.join(tmpdir(), "genieterm", "out");
        expect(
            buildFolderDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/out", destinationPath, "folder-job-1")
        ).toEqual({
            id: "folder-job-1",
            operation: "download",
            itemType: "folder",
            transport: process.platform === "win32" ? "scp" : "rsync",
            source: "wsh://paw-5090-ws/~/projects/out",
            destination: pathToFileURL(destinationPath).href,
            label: "out",
        });
        expect(
            buildFolderDownloadTransferJobInput(
                "genie://paw-5090-ws/~/projects/out",
                "C:\\Users\\me\\Desktop\\out",
                "folder-job-2",
                "win32"
            ).transport
        ).toBe("scp");
    });

    it("maps folder download failures to stable queue error codes and user messages", () => {
        expect(mapFolderDownloadError("parse", new Error("bad path"))).toEqual({
            code: "invalid_source",
            message: "Could not parse the remote folder path.",
            retryable: false,
            detail: "bad path",
        });
        expect(mapFolderDownloadError("destination", new Error("exists as a file"))).toEqual({
            code: "destination_error",
            message: "Could not prepare the destination folder.",
            retryable: true,
            detail: "exists as a file",
        });
        expect(mapFolderDownloadError("start", new Error("ENOENT"))).toEqual({
            code: "transfer_start_failed",
            message: "Could not start the folder transfer.",
            retryable: true,
            detail: "ENOENT",
        });
        expect(mapFolderDownloadError("exit", new Error("permission denied"))).toEqual({
            code: "transfer_failed",
            message: "Folder transfer failed.",
            retryable: true,
            detail: "permission denied",
        });
        expect(mapFolderDownloadError("canceled")).toEqual({
            code: "download_canceled",
            message: "Folder download canceled.",
            retryable: true,
        });
    });
});
