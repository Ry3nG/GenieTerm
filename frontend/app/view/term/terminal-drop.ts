import { parseTransferPath } from "@/util/transferutil";
import { quoteForPosixShell } from "./termutil";

export function getDraggedFileTerminalPath(draggedFile: DraggedFile): string {
    if (!draggedFile) {
        return "";
    }
    if (draggedFile.path) {
        return draggedFile.path;
    }
    if (draggedFile.uri) {
        try {
            return parseTransferPath(draggedFile.uri).path;
        } catch {
            return draggedFile.uri;
        }
    }
    if (draggedFile.absParent && draggedFile.relName) {
        return joinRemotePath(draggedFile.absParent, draggedFile.relName);
    }
    return "";
}

export function formatDraggedFileTerminalPaste(draggedFile: DraggedFile): string {
    const filePath = getDraggedFileTerminalPath(draggedFile);
    if (!filePath) {
        return "";
    }
    return `${quoteForPosixShell(filePath)} `;
}

function joinRemotePath(parent: string, child: string): string {
    if (parent.endsWith("/")) {
        return `${parent}${child}`;
    }
    return `${parent}/${child}`;
}
