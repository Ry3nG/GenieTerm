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

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

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

export function parseWshRemoteUri(filePath: string): ParsedWshRemoteUri {
    const scheme = getRemoteUriScheme(filePath);
    if (!scheme) {
        throw new Error("Folder download only supports remote genie:// or wsh:// paths");
    }
    const uriBody = filePath.slice(getRemoteUriPrefix(scheme).length);
    const slashIdx = uriBody.indexOf("/");
    if (slashIdx < 1 || slashIdx === uriBody.length - 1) {
        throw new Error(`Invalid remote path: ${filePath}`);
    }
    const connection = safeDecodeURIComponent(uriBody.slice(0, slashIdx));
    const remotePath = safeDecodeURIComponent(uriBody.slice(slashIdx + 1));
    if (!connection || !remotePath) {
        throw new Error(`Invalid remote path: ${filePath}`);
    }
    if (connection === "local") {
        throw new Error("Folder download requires a remote connection");
    }
    return { scheme, connection, remotePath };
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

export function buildRsyncFolderArgs(remoteUri: string, destinationPath: string): string[] {
    const parsed = parseWshRemoteUri(remoteUri);
    return [
        "-az",
        `${parsed.connection}:${ensureTrailingSlash(parsed.remotePath)}`,
        ensureTrailingSlash(destinationPath),
    ];
}

export function toPublicRemoteUri(remoteUri: string): string {
    const parsed = parseWshRemoteUri(remoteUri);
    return buildRemoteUri("genie", parsed.connection, parsed.remotePath);
}

function localPathToFileUri(localPath: string): string {
    return encodeURI(`file://${localPath}`);
}

export function parseTransferPath(value: string): ParsedTransferPath {
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
        const localPath = safeDecodeURIComponent(url.pathname);
        return {
            kind: "local",
            uri: value,
            path: localPath,
            basename: getRemotePathBaseName(localPath),
        };
    }
    return {
        kind: "local",
        uri: localPathToFileUri(value),
        path: value,
        basename: getRemotePathBaseName(value),
    };
}
