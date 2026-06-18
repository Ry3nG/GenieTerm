import { createBlock, getApi } from "@/app/store/global";
import { makeNativeLabel } from "./platformutil";
import { fireAndForget } from "./util";
import { formatRemoteUri } from "./waveutil";

type OpenMenuItemsOptions = {
    terminalCwd?: string;
};

export function addOpenMenuItems(
    menu: ContextMenuItem[],
    conn: string,
    finfo: FileInfo,
    opts: OpenMenuItemsOptions = {}
): ContextMenuItem[] {
    if (!finfo) {
        return menu;
    }
    const terminalCwd = opts.terminalCwd || (finfo.isdir ? finfo.path : finfo.dir);
    menu.push({
        type: "separator",
    });
    if (!conn) {
        // TODO:  resolve correct host path if connection is WSL
        // if the entry is a directory, reveal it in the file manager, if the entry is a file, reveal its parent directory
        menu.push({
            label: makeNativeLabel(true),
            click: () => {
                getApi().openNativePath(finfo.isdir ? finfo.path : finfo.dir);
            },
        });
        // if the entry is a file, open it in the default application
        if (!finfo.isdir) {
            menu.push({
                label: makeNativeLabel(false),
                click: () => {
                    getApi().openNativePath(finfo.path);
                },
            });
        }
    } else {
        menu.push({
            label: finfo.isdir ? "Download Folder" : "Download File",
            click: () => {
                const remoteUri = formatRemoteUri(finfo.path, conn);
                if (finfo.isdir) {
                    getApi().downloadFolder(remoteUri);
                } else {
                    getApi().downloadFile(remoteUri);
                }
            },
        });
    }
    menu.push({
        type: "separator",
    });
    if (!finfo.isdir) {
        menu.push({
            label: "Open Preview in New Block",
            click: () =>
                fireAndForget(async () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "preview",
                            file: finfo.path,
                            connection: conn,
                        },
                    };
                    await createBlock(blockDef);
                }),
        });
    }
    menu.push({
        label: "Open Terminal Here",
        click: () => {
            const termBlockDef: BlockDef = {
                meta: {
                    controller: "shell",
                    view: "term",
                    "cmd:cwd": terminalCwd,
                    connection: conn,
                },
            };
            fireAndForget(() => createBlock(termBlockDef));
        },
    });
    return menu;
}
