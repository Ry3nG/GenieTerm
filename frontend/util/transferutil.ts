import { PLATFORM, PlatformWindows } from "./platformutil";

export type RemoteUriScheme = "genie" | "wsh";

export type ParsedWshRemoteUri = {
    scheme: RemoteUriScheme;
    connection: string;
    remotePath: string;
};

export type ParsedTransferPath =
    | {
          kind: "remote";
          uri: string;
          connection: string;
          path: string;
          basename: string;
      }
    | {
          kind: "local";
          uri: string;
          path: string;
          basename: string;
      };

export type ParsedSshConnection = {
    user?: string;
    host: string;
    port?: string;
};

export type SshPortFlag = "-p" | "-P";

export type RemotePathQuoting = "posix-shell" | "none";

export type RsyncFolderArgsOptions = {
    sshArgs?: string[];
    protectArgs?: boolean;
};

export const SshConnectTimeoutSeconds = 15;

// Mirrors userHostRe in pkg/remote/connutil.go (plus "_" in host aliases), which also guarantees that a connection
// never starts with "-" and so can never be read as an option by ssh/rsync/scp.
const SshConnectionRe = /^(?:([A-Za-z0-9][A-Za-z0-9._@\\-]*)@)?([A-Za-z0-9][A-Za-z0-9._-]*)(?::([0-9]{1,5}))?$/;
const WslConnectionRe = /^wsl:\/\/[^/]+/;
const SafeShellWordRe = /^[A-Za-z0-9_@%+=:,./~-]+$/;

export function ensureTrailingSlash(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

function getRemoteUriScheme(filePath: string): RemoteUriScheme | null {
    if (typeof filePath !== "string") {
        return null;
    }
    if (filePath.startsWith("genie://")) {
        return "genie";
    }
    if (filePath.startsWith("wsh://")) {
        return "wsh";
    }
    return null;
}

function getRemoteUriPrefix(scheme: RemoteUriScheme): string {
    return `${scheme}://`;
}

export function buildRemoteUri(scheme: RemoteUriScheme, connection: string, remotePath: string): string {
    return `${scheme}://${connection}/${remotePath}`;
}

export function isWslConnection(connection: string): boolean {
    return typeof connection === "string" && connection.startsWith("wsl://");
}

// Matches the wsh branch of connparse.ParseURI in pkg/remote/connparse/connparse.go. Like the Go parser this does
// NOT percent-decode the connection or path, so "a%20b" stays a literal file name.
function normalizeWshRemotePath(remotePath: string): string {
    if (remotePath.startsWith("/~")) {
        return remotePath.slice(1);
    }
    if (
        remotePath.length > 1 &&
        !/^[A-Za-z]:/.test(remotePath) &&
        !remotePath.startsWith("/") &&
        !remotePath.startsWith("~") &&
        !remotePath.startsWith("./") &&
        !remotePath.startsWith("../") &&
        !remotePath.startsWith(".\\") &&
        !remotePath.startsWith("..\\") &&
        remotePath !== ".."
    ) {
        return `/${remotePath}`;
    }
    return remotePath;
}

export function parseWshRemoteUri(filePath: string): ParsedWshRemoteUri {
    const scheme = getRemoteUriScheme(filePath);
    if (!scheme) {
        throw new Error("Folder download only supports remote genie:// or wsh:// paths");
    }
    const uriBody = filePath.slice(getRemoteUriPrefix(scheme).length);
    let connection: string;
    let rawRemotePath: string;
    if (uriBody.startsWith("wsl://")) {
        connection = uriBody.match(WslConnectionRe)?.[0] ?? "";
        rawRemotePath = uriBody.slice(connection.length);
        if (!rawRemotePath.startsWith("/")) {
            throw new Error(`Invalid remote path: ${filePath}`);
        }
        rawRemotePath = rawRemotePath.slice(1);
    } else {
        const slashIdx = uriBody.indexOf("/");
        if (slashIdx < 1) {
            throw new Error(`Invalid remote path: ${filePath}`);
        }
        connection = uriBody.slice(0, slashIdx);
        rawRemotePath = uriBody.slice(slashIdx + 1);
    }
    const remotePath = rawRemotePath === "" ? "/" : normalizeWshRemotePath(rawRemotePath);
    if (!connection || !remotePath) {
        throw new Error(`Invalid remote path: ${filePath}`);
    }
    if (connection === "local") {
        throw new Error("Folder download requires a remote connection");
    }
    return { scheme, connection, remotePath };
}

export function parseSshConnection(connection: string): ParsedSshConnection {
    if (isWslConnection(connection)) {
        throw new Error("Folder download is not available for WSL connections.");
    }
    const match = typeof connection === "string" ? connection.match(SshConnectionRe) : null;
    if (match == null) {
        throw new Error(`Unsupported SSH connection name: ${connection}`);
    }
    const [, user, host, port] = match;
    if (port != null && (Number(port) < 1 || Number(port) > 65535)) {
        throw new Error(`Invalid SSH port in connection: ${connection}`);
    }
    return {
        ...(user ? { user } : {}),
        host,
        ...(port ? { port } : {}),
    };
}

export function getRemotePathBaseName(remotePath: string): string {
    const normalized = remotePath.replace(/\/+$/, "");
    const lastSlashIdx = normalized.lastIndexOf("/");
    const baseName = lastSlashIdx >= 0 ? normalized.slice(lastSlashIdx + 1) : normalized;
    if (!baseName || baseName === "~") {
        return "download";
    }
    return baseName;
}

export function quotePosixShellArg(value: string): string {
    if (value !== "" && SafeShellWordRe.test(value)) {
        return value;
    }
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

// rsync -e strings are split by rsync itself (not a shell): both rsync 3 and macOS openrsync honor single and
// double quotes but give backslashes no special meaning, so a word can only be wrapped in a quote it doesn't contain.
export function quoteRsyncRemoteShellWord(value: string): string {
    if (/[\r\n\0]/.test(value)) {
        throw new Error(`Unsupported character in SSH option: ${JSON.stringify(value)}`);
    }
    if (value !== "" && !/[\s'"]/.test(value)) {
        return value;
    }
    if (!value.includes('"')) {
        return `"${value}"`;
    }
    if (!value.includes("'")) {
        return `'${value}'`;
    }
    throw new Error(`SSH option cannot contain both quote characters: ${value}`);
}

export function buildRsyncRemoteShellCommand(sshArgs: string[]): string {
    return ["ssh", ...sshArgs].map(quoteRsyncRemoteShellWord).join(" ");
}

// Remote copy paths are resolved relative to the login directory, so "~/x" becomes "x" and no shell or SFTP-side
// tilde expansion is needed; a leading "-" is guarded so the remote rsync/scp never sees it as an option.
export function toRemoteCopyPath(remotePath: string): string {
    let copyPath = remotePath;
    if (copyPath === "~") {
        copyPath = ".";
    } else if (copyPath.startsWith("~/")) {
        copyPath = copyPath.slice(2).replace(/^\/+/, "") || "./";
    }
    if (copyPath.startsWith("-")) {
        copyPath = `./${copyPath}`;
    }
    return copyPath;
}

export function formatRemoteCopyOperand(
    connection: ParsedSshConnection,
    remotePath: string,
    quoting: RemotePathQuoting
): string {
    const target = connection.user ? `${connection.user}@${connection.host}` : connection.host;
    const copyPath = toRemoteCopyPath(remotePath);
    return `${target}:${quoting === "posix-shell" ? quotePosixShellArg(copyPath) : copyPath}`;
}

function nonEmptyList(values: string[] | undefined): string[] {
    return Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim() !== "") : [];
}

// GenieTerm connection settings (ConnKeywords) mapped onto OpenSSH client flags so the system ssh used by rsync/scp
// reaches the same host the terminal does. BatchMode is forced because there is no TTY to answer prompts.
export function buildSshOptionArgs(
    connection: ParsedSshConnection,
    keywords: ConnKeywords | undefined,
    portFlag: SshPortFlag
): string[] {
    const args = ["-o", "BatchMode=yes", "-o", `ConnectTimeout=${SshConnectTimeoutSeconds}`];
    const port = connection.port ?? keywords?.["ssh:port"];
    if (port != null && `${port}`.trim() !== "") {
        if (!/^[0-9]{1,5}$/.test(`${port}`.trim())) {
            throw new Error(`Invalid ssh:port setting: ${port}`);
        }
        args.push(portFlag, `${port}`.trim());
    }
    const hostName = keywords?.["ssh:hostname"];
    if (hostName && hostName.trim() !== "" && hostName !== connection.host) {
        args.push("-o", `HostName=${hostName.trim()}`);
    }
    if (!connection.user && keywords?.["ssh:user"]) {
        args.push("-o", `User=${keywords["ssh:user"].trim()}`);
    }
    for (const identityFile of nonEmptyList(keywords?.["ssh:identityfile"])) {
        args.push("-i", identityFile);
    }
    if (keywords?.["ssh:identitiesonly"] != null) {
        args.push("-o", `IdentitiesOnly=${keywords["ssh:identitiesonly"] ? "yes" : "no"}`);
    }
    if (keywords?.["ssh:identityagent"]) {
        args.push("-o", `IdentityAgent=${keywords["ssh:identityagent"]}`);
    }
    const knownHostsFiles = nonEmptyList(keywords?.["ssh:userknownhostsfile"]);
    if (knownHostsFiles.length > 0) {
        args.push("-o", `UserKnownHostsFile=${knownHostsFiles.join(" ")}`);
    }
    const proxyJump = nonEmptyList(keywords?.["ssh:proxyjump"]);
    if (proxyJump.length > 0) {
        args.push("-J", proxyJump.join(","));
    }
    return args;
}

export function buildRsyncFolderArgs(
    remoteUri: string,
    destinationPath: string,
    options: RsyncFolderArgsOptions = {}
): string[] {
    const parsed = parseWshRemoteUri(remoteUri);
    const connection = parseSshConnection(parsed.connection);
    const sshArgs = options.sshArgs ?? buildSshOptionArgs(connection, undefined, "-p");
    // rsync >= 3 sends -s (protect-args) file names over the protocol, so the path must stay unquoted; older rsync
    // and macOS openrsync hand the path to the remote shell, which would split "My Docs" or run "$(...)".
    const quoting: RemotePathQuoting = options.protectArgs ? "none" : "posix-shell";
    return [
        "-az",
        "-e",
        buildRsyncRemoteShellCommand(sshArgs),
        ...(options.protectArgs ? ["-s"] : []),
        "--",
        formatRemoteCopyOperand(connection, ensureTrailingSlash(parsed.remotePath), quoting),
        ensureTrailingSlash(destinationPath),
    ];
}

function encodePathSegments(segments: string[]): string {
    return segments.map(encodeURIComponent).join("/");
}

export function localPathToFileUri(localPath: string, platform: NodeJS.Platform = PLATFORM): string {
    if (/^[A-Za-z]:[\\/]/.test(localPath)) {
        const [drive, ...segments] = localPath.replace(/\\/g, "/").split("/");
        return `file:///${drive}/${encodePathSegments(segments)}`;
    }
    if (platform === PlatformWindows && /^[\\/]{2}[^\\/]+[\\/]/.test(localPath)) {
        const [host, ...segments] = localPath.replace(/\\/g, "/").slice(2).split("/");
        return `file://${host}/${encodePathSegments(segments)}`;
    }
    return `file://${encodePathSegments(localPath.split("/"))}`;
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function parseTransferPath(value: string, platform = PLATFORM): ParsedTransferPath {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error("Transfer path must be a non-empty string");
    }
    if (getRemoteUriScheme(value)) {
        const parsed = parseWshRemoteUri(value);
        return {
            kind: "remote",
            uri: value,
            connection: parsed.connection,
            path: parsed.remotePath,
            basename: getRemotePathBaseName(parsed.remotePath),
        };
    }
    if (value.startsWith("file://")) {
        const url = new URL(value);
        let localPath = safeDecodeURIComponent(url.pathname);
        if (platform === PlatformWindows && /^\/[A-Za-z]:\//.test(localPath)) {
            localPath = localPath.slice(1).replace(/\//g, "\\");
        } else if (platform === PlatformWindows && url.host) {
            localPath = `\\\\${url.host}${localPath.replace(/\//g, "\\")}`;
        }
        return {
            kind: "local",
            uri: value,
            path: localPath,
            basename: getRemotePathBaseName(localPath.replace(/\\/g, "/")),
        };
    }
    return {
        kind: "local",
        uri: localPathToFileUri(value, platform),
        path: value,
        basename: getRemotePathBaseName(value.replace(/\\/g, "/")),
    };
}
