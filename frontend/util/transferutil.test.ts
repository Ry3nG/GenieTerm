import { describe, expect, it } from "vitest";

import {
    buildRsyncFolderArgs,
    buildRsyncRemoteShellCommand,
    buildSshOptionArgs,
    ensureTrailingSlash,
    formatRemoteCopyOperand,
    getRemotePathBaseName,
    isWslConnection,
    localPathToFileUri,
    parseSshConnection,
    parseTransferPath,
    parseWshRemoteUri,
    quotePosixShellArg,
    quoteRsyncRemoteShellWord,
    toRemoteCopyPath,
} from "./transferutil";

const DefaultSshArgs = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];

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

    it("normalizes paths like the Go connparse parser", () => {
        expect(parseWshRemoteUri("genie://server/var/log").remotePath).toBe("/var/log");
        expect(parseWshRemoteUri("genie://server//~/x").remotePath).toBe("~/x");
        expect(parseWshRemoteUri("genie://server/./rel").remotePath).toBe("./rel");
    });

    it("keeps percent sequences literal like the Go parser", () => {
        expect(parseWshRemoteUri("wsh://host/~/a%20b")).toEqual({
            scheme: "wsh",
            connection: "host",
            remotePath: "~/a%20b",
        });
        expect(parseWshRemoteUri("genie://host//tmp/100%")).toMatchObject({ remotePath: "/tmp/100%" });
    });

    it("parses WSL connections that contain their own scheme", () => {
        expect(parseWshRemoteUri("genie://wsl://Ubuntu//home/u/x")).toEqual({
            scheme: "genie",
            connection: "wsl://Ubuntu",
            remotePath: "/home/u/x",
        });
        expect(isWslConnection("wsl://Ubuntu")).toBe(true);
        expect(isWslConnection("devbox")).toBe(false);
        expect(() => parseSshConnection("wsl://Ubuntu")).toThrow("not available for WSL");
    });

    it("rejects local and malformed remote URIs", () => {
        expect(() => parseWshRemoteUri("/tmp/file")).toThrow("remote genie:// or wsh:// paths");
        expect(() => parseWshRemoteUri("wsh://local/~/file")).toThrow("Folder download requires a remote connection");
        expect(() => parseWshRemoteUri("wsh://missing-path")).toThrow("Invalid remote path");
    });

    it("parses root-path remote URIs with a trailing slash", () => {
        expect(parseWshRemoteUri("genie://paw-5090-ws/")).toEqual({
            scheme: "genie",
            connection: "paw-5090-ws",
            remotePath: "/",
        });
        expect(parseWshRemoteUri("wsh://paw-5090-ws/")).toEqual({
            scheme: "wsh",
            connection: "paw-5090-ws",
            remotePath: "/",
        });
    });

    it("parses user, host, and port from SSH connection names", () => {
        expect(parseSshConnection("me@host:2222")).toEqual({ user: "me", host: "host", port: "2222" });
        expect(parseSshConnection("devbox")).toEqual({ host: "devbox" });
        expect(parseSshConnection("first.last@corp.example.com")).toEqual({
            user: "first.last",
            host: "corp.example.com",
        });
        expect(() => parseSshConnection("-oProxyCommand=evil")).toThrow("Unsupported SSH connection name");
        expect(() => parseSshConnection("me@-oProxyCommand=evil")).toThrow("Unsupported SSH connection name");
        expect(() => parseSshConnection("host:99999")).toThrow("Invalid SSH port");
        expect(() => parseSshConnection("host;rm -rf ~")).toThrow("Unsupported SSH connection name");
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

    it("quotes remote paths for a POSIX remote shell", () => {
        expect(quotePosixShellArg("projects/out/")).toBe("projects/out/");
        expect(quotePosixShellArg("My Docs/")).toBe("'My Docs/'");
        expect(quotePosixShellArg("$(touch pwned)")).toBe("'$(touch pwned)'");
        expect(quotePosixShellArg("a;b")).toBe("'a;b'");
        expect(quotePosixShellArg("it's")).toBe("'it'\\''s'");
        expect(quotePosixShellArg("")).toBe("''");
    });

    it("maps remote paths to login-relative copy paths and guards leading dashes", () => {
        expect(toRemoteCopyPath("~/projects/out/")).toBe("projects/out/");
        expect(toRemoteCopyPath("~/")).toBe("./");
        expect(toRemoteCopyPath("~")).toBe(".");
        expect(toRemoteCopyPath("/var/log/")).toBe("/var/log/");
        expect(toRemoteCopyPath("-rf")).toBe("./-rf");
        expect(toRemoteCopyPath("~/-rf")).toBe("./-rf");
    });

    it("formats remote operands for shell-interpreting and protocol-protected transports", () => {
        const connection = { user: "me", host: "host" };
        expect(formatRemoteCopyOperand(connection, "~/My Docs/", "posix-shell")).toBe("me@host:'My Docs/'");
        expect(formatRemoteCopyOperand(connection, "~/My Docs/", "none")).toBe("me@host:My Docs/");
        expect(formatRemoteCopyOperand({ host: "host" }, "/srv/$(id)/", "posix-shell")).toBe("host:'/srv/$(id)/'");
    });

    it("quotes rsync -e words with quotes rsync and openrsync both understand", () => {
        expect(quoteRsyncRemoteShellWord("BatchMode=yes")).toBe("BatchMode=yes");
        expect(quoteRsyncRemoteShellWord("/Users/me/My Keys/id")).toBe('"/Users/me/My Keys/id"');
        expect(quoteRsyncRemoteShellWord("/Users/me/it's/id")).toBe('"/Users/me/it\'s/id"');
        expect(quoteRsyncRemoteShellWord('a "b"')).toBe("'a \"b\"'");
        expect(() => quoteRsyncRemoteShellWord(`a'"b`)).toThrow("both quote characters");
        expect(() => quoteRsyncRemoteShellWord("a\nb")).toThrow("Unsupported character");
        expect(buildRsyncRemoteShellCommand(["-p", "2222", "-i", "/tmp/a b"])).toBe('ssh -p 2222 -i "/tmp/a b"');
    });

    it("maps GenieTerm connection settings to ssh options", () => {
        expect(buildSshOptionArgs({ host: "devbox" }, undefined, "-p")).toEqual(DefaultSshArgs);
        expect(buildSshOptionArgs({ user: "me", host: "host", port: "2222" }, undefined, "-P")).toEqual([
            ...DefaultSshArgs,
            "-P",
            "2222",
        ]);
        expect(
            buildSshOptionArgs(
                { host: "devbox" },
                {
                    "ssh:hostname": "10.0.0.5",
                    "ssh:user": "deploy",
                    "ssh:port": "2200",
                    "ssh:identityfile": ["~/.ssh/id_devbox", "/keys/My Key"],
                    "ssh:identitiesonly": true,
                    "ssh:proxyjump": ["bastion", "jump2"],
                    "ssh:userknownhostsfile": ["~/.ssh/known_hosts", "~/.ssh/known_hosts2"],
                },
                "-p"
            )
        ).toEqual([
            ...DefaultSshArgs,
            "-p",
            "2200",
            "-o",
            "HostName=10.0.0.5",
            "-o",
            "User=deploy",
            "-i",
            "~/.ssh/id_devbox",
            "-i",
            "/keys/My Key",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "UserKnownHostsFile=~/.ssh/known_hosts ~/.ssh/known_hosts2",
            "-J",
            "bastion,jump2",
        ]);
    });

    it("lets the user and port in the connection name win over connection settings", () => {
        expect(
            buildSshOptionArgs(
                { user: "me", host: "host", port: "2222" },
                { "ssh:user": "other", "ssh:port": "22" },
                "-p"
            )
        ).toEqual([...DefaultSshArgs, "-p", "2222"]);
        expect(() => buildSshOptionArgs({ host: "h" }, { "ssh:port": "22; rm" }, "-p")).toThrow(
            "Invalid ssh:port setting"
        );
    });

    it("builds rsync folder args with explicit port, batch mode, and an option terminator", () => {
        expect(buildRsyncFolderArgs("genie://me@host:2222/~/out", "/Users/me/Desktop/out")).toEqual([
            "-az",
            "-e",
            "ssh -o BatchMode=yes -o ConnectTimeout=15 -p 2222",
            "--",
            "me@host:out/",
            "/Users/me/Desktop/out/",
        ]);
        expect(buildRsyncFolderArgs("wsh://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out")).toEqual([
            "-az",
            "-e",
            "ssh -o BatchMode=yes -o ConnectTimeout=15",
            "--",
            "paw-5090-ws:projects/out/",
            "/Users/me/Desktop/out/",
        ]);
    });

    it("quotes remote rsync paths for openrsync and protects them with -s for rsync 3", () => {
        expect(buildRsyncFolderArgs("genie://host/~/My Docs", "/tmp/My Docs").slice(3)).toEqual([
            "--",
            "host:'My Docs/'",
            "/tmp/My Docs/",
        ]);
        expect(buildRsyncFolderArgs("genie://host//srv/$(id);x", "/tmp/x").slice(3)).toEqual([
            "--",
            "host:'/srv/$(id);x/'",
            "/tmp/x/",
        ]);
        expect(buildRsyncFolderArgs("genie://host/~/My Docs", "/tmp/My Docs", { protectArgs: true }).slice(3)).toEqual([
            "-s",
            "--",
            "host:My Docs/",
            "/tmp/My Docs/",
        ]);
    });

    it("rejects folder downloads for connection names that could be read as options", () => {
        expect(() => buildRsyncFolderArgs("genie://-oProxyCommand=x/~/out", "/tmp/out")).toThrow(
            "Unsupported SSH connection name"
        );
    });

    it("builds Go-compatible file URIs for POSIX, Windows drive, and UNC paths", () => {
        expect(localPathToFileUri("/home/me/a b/#1 100%.txt", "darwin")).toBe(
            "file:///home/me/a%20b/%231%20100%25.txt"
        );
        expect(localPathToFileUri("C:\\Users\\me\\My Files\\#1 100%.txt", "win32")).toBe(
            "file:///C:/Users/me/My%20Files/%231%20100%25.txt"
        );
        expect(localPathToFileUri("C:/Users/me/out", "win32")).toBe("file:///C:/Users/me/out");
        expect(localPathToFileUri("\\\\server\\share\\My Dir\\a.txt", "win32")).toBe(
            "file://server/share/My%20Dir/a.txt"
        );
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
        expect(parseTransferPath("C:\\Users\\me\\My Files\\out", "win32")).toEqual({
            kind: "local",
            uri: "file:///C:/Users/me/My%20Files/out",
            path: "C:\\Users\\me\\My Files\\out",
            basename: "out",
        });
        expect(parseTransferPath("file:///C:/Users/me/My%20Files/out", "win32")).toEqual({
            kind: "local",
            uri: "file:///C:/Users/me/My%20Files/out",
            path: "C:\\Users\\me\\My Files\\out",
            basename: "out",
        });
        expect(parseTransferPath("file://server/share/My%20Dir", "win32")).toMatchObject({
            path: "\\\\server\\share\\My Dir",
            basename: "My Dir",
        });
    });
});
