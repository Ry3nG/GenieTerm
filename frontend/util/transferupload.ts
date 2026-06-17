import type { TransferItemType, TransferJobInput } from "./transferqueue";
import { getRemotePathBaseName, parseWshRemoteUri } from "./transferutil";

export type LocalUploadItem = {
    path: string;
    name?: string;
    itemType?: TransferItemType;
};

export type UploadTransferPlan = {
    srcuri: string;
    desturi: string;
    jobInput: TransferJobInput;
};

export type UploadTransferPlanOptions = {
    createId?: (item: LocalUploadItem, index: number) => string;
    groupId?: string;
};

let nextUploadTransferSeq = 0;
let nextUploadTransferGroupSeq = 0;

export function createUploadTransferJobId(prefix = "upload"): string {
    nextUploadTransferSeq += 1;
    return `${prefix}-${Date.now()}-${nextUploadTransferSeq}`;
}

export function createUploadTransferGroupId(prefix = "upload-group"): string {
    nextUploadTransferGroupSeq += 1;
    return `${prefix}-${Date.now()}-${nextUploadTransferGroupSeq}`;
}

export function buildLocalUploadTransferPlans(
    items: LocalUploadItem[],
    remoteDestDirUri: string,
    options: UploadTransferPlanOptions = {}
): UploadTransferPlan[] {
    const destDir = parseRemoteUploadDestination(remoteDestDirUri);
    const createId = options.createId ?? (() => createUploadTransferJobId());
    return items.map((item, index) => {
        const localPath = normalizeLocalPath(item.path);
        const label = getUploadItemBasename(item);
        const srcuri = buildLocalUploadFileUri(localPath);
        const destination = appendRemotePathSegment(destDir.connection, destDir.remotePath, label);
        return {
            srcuri,
            desturi: remoteDestDirUri,
            jobInput: {
                id: createId(item, index),
                operation: "upload",
                itemType: item.itemType ?? "file",
                transport: "wsh",
                source: srcuri,
                destination,
                label,
                ...(options.groupId ? { groupId: options.groupId } : {}),
            },
        };
    });
}

export function buildLocalUploadFileUri(localPath: string): string {
    return encodeURI(`file://${normalizeLocalPath(localPath)}`);
}

function parseRemoteUploadDestination(remoteDestDirUri: string): { connection: string; remotePath: string } {
    try {
        return parseWshRemoteUri(remoteDestDirUri);
    } catch (err) {
        throw new Error(`Upload destination must be a remote wsh:// directory: ${err}`);
    }
}

function getUploadItemBasename(item: LocalUploadItem): string {
    const candidate = item.name || item.path;
    const basename = getRemotePathBaseName(candidate);
    if (!basename) {
        throw new Error(`Upload item must have a basename: ${item.path}`);
    }
    return basename;
}

function normalizeLocalPath(localPath: string): string {
    if (typeof localPath !== "string" || localPath.length === 0) {
        throw new Error("Upload item path must be a non-empty string");
    }
    if (localPath === "/" || localPath.startsWith("file://") || localPath.startsWith("wsh://")) {
        throw new Error("Upload item path must be an absolute local file path");
    }
    return localPath;
}

function appendRemotePathSegment(connection: string, remoteDirPath: string, segment: string): string {
    const trimmedDir = trimRemoteDirectory(remoteDirPath);
    const remotePath = trimmedDir === "/" ? `/${segment}` : `${trimmedDir}/${segment}`;
    return `wsh://${connection}/${remotePath}`;
}

function trimRemoteDirectory(remoteDirPath: string): string {
    if (remoteDirPath === "/") {
        return "/";
    }
    const trimmed = remoteDirPath.replace(/\/+$/, "");
    if (trimmed === "" && remoteDirPath.startsWith("/")) {
        return "/";
    }
    return trimmed;
}
