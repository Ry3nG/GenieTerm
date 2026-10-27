// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { addOpenMenuItems } from "@/util/previewutil";
import type { TransferError, TransferItemType, TransferJob } from "@/util/transferqueue";
import {
    buildLocalUploadTransferPlans,
    createUploadTransferGroupId,
    createUploadTransferJobId,
    type LocalUploadItem,
} from "@/util/transferupload";
import { cn, fireAndForget } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import {
    Header,
    Row,
    RowData,
    SortingState,
    Table,
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PrimitiveAtom, atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { debounce } from "throttle-debounce";
import {
    getTransferSelection,
    selectDirectoryEntry,
    type DirectorySelection,
    type SelectionModifiers,
} from "./directory-selection";
import { DirectoryUploadDropOverlay } from "./directory-upload-drop-overlay";
import "./directorypreview.scss";
import { EntryManagerOverlay, EntryManagerOverlayProps, EntryManagerType } from "./entry-manager";
import { DirectoryTreeView } from "./preview-directory-tree";
import {
    DirectoryColumnWidths,
    DirectoryNameMinWidth,
    DirectoryPermMinWidth,
    confirmFileDelete,
    copyWithOverwriteConfirmation,
    getBestUnit,
    getDirectoryColumnSizing,
    getDirectoryFocusIndex,
    getDirectoryHiddenColumns,
    getFileKind,
    getLastModifiedTime,
    getSortIcon,
    handleRename,
    isFileCopyFailure,
    isIconValid,
    isParentDirEntry,
    makeDirectoryDefaultMenuItems,
    parentDirectoryFirst,
    resizeDirectoryColumns,
    type FileCopyResult,
} from "./preview-directory-utils";
import {
    getPreviewFileName,
    getPreviewRenamePath,
    isLocalWindowsFilePath,
    quotePreviewFilePath,
} from "./preview-file-path";
import { type PreviewModel } from "./preview-model";
import type { PreviewEnv } from "./previewenv";
import { DirectoryTransferQueueStatus } from "./transfer-queue-status";

const PageJumpSize = 20;
const CopyTimeoutYear = 31536000000;

type WebKitDataTransferItem = DataTransferItem & {
    webkitGetAsEntry?: () => { isDirectory?: boolean; isFile?: boolean; name?: string };
};

function hasNativeFiles(dataTransfer: DataTransfer): boolean {
    return dataTransfer.types.includes("Files");
}

function getDroppedItemType(dataTransfer: DataTransfer, index: number): TransferItemType {
    const item = dataTransfer.items?.[index] as WebKitDataTransferItem;
    const entry = item?.webkitGetAsEntry?.();
    return entry?.isDirectory ? "folder" : "file";
}

function toUploadOutcome(result: FileCopyResult): TransferJobOutcome {
    if (!isFileCopyFailure(result)) {
        return { status: "completed" };
    }
    if (result.canceled) {
        return { status: "canceled" };
    }
    return { status: "failed", error: makeUploadFailure(result.errorText, result.retryable) };
}

function makeUploadFailure(errorText: string, retryable: boolean): TransferError {
    return {
        code: retryable ? "upload_confirmation_required" : "upload_failed",
        message: retryable ? "Transfer needs confirmation." : "Transfer failed.",
        detail: errorText,
        retryable,
    };
}

interface DirectoryTableHeaderCellProps {
    header: Header<FileInfo, unknown>;
}

function DirectoryTableHeaderCell({ header }: DirectoryTableHeaderCellProps) {
    return (
        <div
            className={cn("dir-table-head-cell", "col-" + header.column.id)}
            key={header.id}
            style={{ width: `calc(var(--header-${header.id}-size) * 1px)` }}
        >
            <div
                className={cn("dir-table-head-cell-content", header.column.getCanSort() && "cursor-pointer")}
                onClick={header.column.getToggleSortingHandler()}
            >
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                {getSortIcon(header.column.getIsSorted())}
            </div>
            {header.column.getCanResize() && (
                <div className="dir-table-head-resize-box">
                    <div
                        className="dir-table-head-resize"
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                    />
                </div>
            )}
        </div>
    );
}

declare module "@tanstack/react-table" {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface TableMeta<TData extends RowData> {
        updateName: (path: string, isDir: boolean) => void;
        newFile: () => void;
        newDirectory: () => void;
    }
}

interface DirectoryTableProps {
    selection: DirectorySelection;
    onSelect: (entry: FileInfo, visible: FileInfo[], modifiers: SelectionModifiers) => void;
    model: PreviewModel;
    data: FileInfo[];
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
    entryManagerOverlayPropsAtom: PrimitiveAtom<EntryManagerOverlayProps>;
    newFile: () => void;
    newDirectory: () => void;
}

const columnHelper = createColumnHelper<FileInfo>();

function DirectoryTable({
    selection,
    onSelect,
    model,
    data,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setSelectedPath,
    setRefreshVersion,
    entryManagerOverlayPropsAtom,
    newFile,
    newDirectory,
}: DirectoryTableProps) {
    const env = useWaveEnv<PreviewEnv>();
    const conn = useAtomValue(model.connection);
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const defaultSort = useAtomValue(env.getSettingsKeyAtom("preview:defaultsort")) ?? "name";
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const getIconFromMimeType = useCallback(
        (mimeType: string): string => {
            while (mimeType.length > 0) {
                const icon = fullConfig.mimetypes?.[mimeType]?.icon ?? null;
                if (isIconValid(icon)) {
                    return `fa fa-solid fa-${icon} fa-fw`;
                }
                mimeType = mimeType.slice(0, -1);
            }
            return "fa fa-solid fa-file fa-fw";
        },
        [fullConfig.mimetypes]
    );
    const getIconColor = useCallback(
        (mimeType: string): string => fullConfig.mimetypes?.[mimeType]?.color ?? "inherit",
        [fullConfig.mimetypes]
    );
    const columns = useMemo(
        () => [
            columnHelper.accessor("mimetype", {
                cell: (info) => (
                    <i
                        className={getIconFromMimeType(info.getValue() ?? "")}
                        style={{ color: getIconColor(info.getValue() ?? "") }}
                    ></i>
                ),
                header: () => <span></span>,
                id: "logo",
                size: DirectoryColumnWidths.logo,
                enableResizing: false,
                enableSorting: false,
            }),
            columnHelper.accessor("name", {
                cell: (info) => <span className="dir-table-name ellipsis">{info.getValue()}</span>,
                header: () => <span className="dir-table-head-name">Name</span>,
                sortingFn: "alphanumeric",
                size: DirectoryColumnWidths.name,
                minSize: DirectoryNameMinWidth,
            }),
            columnHelper.accessor("modestr", {
                cell: (info) => <span className="dir-table-modestr">{info.getValue()}</span>,
                header: () => <span>Perm</span>,
                size: DirectoryColumnWidths.modestr,
                minSize: DirectoryPermMinWidth,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("modtime", {
                cell: (info) => <span className="dir-table-lastmod">{getLastModifiedTime(info.getValue())}</span>,
                header: () => <span>Last Modified</span>,
                size: DirectoryColumnWidths.modtime,
                minSize: 148,
                sortingFn: "basic",
            }),
            columnHelper.accessor("size", {
                cell: (info) => (
                    <span className="dir-table-size">
                        {info.row.original.isdir ? "—" : getBestUnit(info.getValue())}
                    </span>
                ),
                header: () => <span className="dir-table-head-size">Size</span>,
                size: DirectoryColumnWidths.size,
                minSize: 88,
                sortingFn: "auto",
            }),
            columnHelper.accessor(getFileKind, {
                id: "mimetype",
                cell: (info) => <span className="dir-table-type ellipsis">{info.getValue()}</span>,
                header: () => <span className="dir-table-head-type">Type</span>,
                size: DirectoryColumnWidths.mimetype,
                minSize: 120,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("path", {}),
        ],
        [fullConfig]
    );

    const setEntryManagerProps = useSetAtom(entryManagerOverlayPropsAtom);

    const updateName = useCallback(
        (path: string, isDir: boolean) => {
            const fileName = getPreviewFileName(path, conn);
            setEntryManagerProps({
                entryManagerType: EntryManagerType.EditName,
                startingValue: fileName,
                onSave: (newName: string) => {
                    if (newName !== fileName) {
                        const newPath = getPreviewRenamePath(path, newName, conn);
                        console.log(`replacing ${fileName} with ${newName}: ${path}`);
                        handleRename(model, path, newPath, isDir, setErrorMsg);
                    }
                    setEntryManagerProps(undefined);
                },
            });
        },
        [model, conn, setErrorMsg]
    );

    const defaultSorting = useMemo<SortingState>(
        () => (defaultSort === "modtime" ? [{ id: "modtime", desc: true }] : [{ id: "name", desc: false }]),
        [defaultSort]
    );
    const [sorting, setSorting] = useState<SortingState>(defaultSorting);

    useEffect(() => {
        setSorting(defaultSorting);
    }, [defaultSorting]);

    const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
    const [viewportWidth, setViewportWidth] = useState(0);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    useEffect(() => {
        if (scrollElement == null) return;
        const observer = new ResizeObserver(() => setViewportWidth(scrollElement.clientWidth));
        observer.observe(scrollElement);
        setViewportWidth(scrollElement.clientWidth);
        return () => observer.disconnect();
    }, [scrollElement]);
    const hiddenColumns = getDirectoryHiddenColumns(viewportWidth);
    const columnSizing = getDirectoryColumnSizing(viewportWidth, columnWidths, hiddenColumns);
    const columnVisibility = useMemo(
        () => Object.fromEntries([["path", false], ...hiddenColumns.map((col) => [col, false])]),
        [hiddenColumns.join(",")]
    );
    const table = useReactTable({
        data,
        columns,
        columnResizeMode: "onChange",
        getSortedRowModel: getSortedRowModel(),
        getCoreRowModel: getCoreRowModel(),

        state: {
            columnSizing,
            columnVisibility,
            sorting,
        },
        onColumnSizingChange: (updater) => {
            const next = typeof updater === "function" ? updater(columnSizing) : updater;
            setColumnWidths(resizeDirectoryColumns(columnSizing, next));
        },
        onSortingChange: setSorting,
        enableMultiSort: false,
        enableSortingRemoval: false,
        meta: {
            updateName,
            newFile,
            newDirectory,
        },
    });
    const sortingState = table.getState().sorting;
    useEffect(() => {
        const allRows = parentDirectoryFirst(table.getRowModel().flatRows);
        setSelectedPath((allRows[focusIndex]?.getValue("path") as string) ?? null);
    }, [focusIndex, data, setSelectedPath, sortingState]);

    const columnSizeVars = useMemo(() => {
        const headers = table.getFlatHeaders();
        const colSizes: { [key: string]: number } = {};
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i]!;
            colSizes[`--header-${header.id}-size`] = header.getSize();
            colSizes[`--col-${header.column.id}-size`] = header.column.getSize();
        }
        return colSizes;
    }, [columnSizing]);

    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [scrollHeight, setScrollHeight] = useState(0);

    const onScroll = useCallback(
        debounce(2, () => {
            setScrollHeight(osRef.current.osInstance().elements().viewport.scrollTop);
        }),
        []
    );

    const TableComponent = table.getState().columnSizingInfo.isResizingColumn ? MemoizedTableBody : TableBody;

    return (
        <OverlayScrollbarsComponent
            role="grid"
            aria-label="Files"
            aria-multiselectable="true"
            options={{ scrollbars: { autoHide: "leave" } }}
            events={{ scroll: onScroll, initialized: (instance) => setScrollElement(instance.elements().viewport) }}
            className="dir-table"
            style={{ ...columnSizeVars }}
            ref={osRef}
            data-scroll-height={scrollHeight}
        >
            <div className="dir-table-head">
                {table.getHeaderGroups().map((headerGroup) => (
                    <div className="dir-table-head-row" key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                            <DirectoryTableHeaderCell key={header.id} header={header} />
                        ))}
                    </div>
                ))}
            </div>
            <TableComponent
                selection={selection}
                onSelect={onSelect}
                bodyRef={bodyRef}
                model={model}
                data={data}
                table={table}
                search={search}
                focusIndex={focusIndex}
                setFocusIndex={setFocusIndex}
                setSearch={setSearch}
                setSelectedPath={setSelectedPath}
                setRefreshVersion={setRefreshVersion}
                osRef={osRef.current}
                scrollElement={scrollElement}
            />
        </OverlayScrollbarsComponent>
    );
}

interface TableBodyProps {
    selection: DirectorySelection;
    onSelect: (entry: FileInfo, visible: FileInfo[], modifiers: SelectionModifiers) => void;
    bodyRef: React.RefObject<HTMLDivElement>;
    model: PreviewModel;
    data: Array<FileInfo>;
    table: Table<FileInfo>;
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
    osRef: OverlayScrollbarsComponentRef;
    scrollElement: HTMLElement | null;
}

function TableBody({
    selection,
    onSelect,
    bodyRef,
    model,
    table,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setRefreshVersion,
    osRef,
    scrollElement,
}: TableBodyProps) {
    const searchActive = useAtomValue(model.directorySearchActive);
    const dummyLineRef = useRef<HTMLDivElement>(null);
    const warningBoxRef = useRef<HTMLDivElement>(null);
    const conn = useAtomValue(model.connection);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const rows = parentDirectoryFirst(table.getRowModel().flatRows);
    const selectedPaths = useMemo(() => new Set(selection.files.map((file) => file.path)), [selection]);
    const visibleFiles = useMemo(() => rows.map((row) => row.original), [table.getRowModel()]);
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollElement,
        estimateSize: () => 30,
        getItemKey: (index) => rows[index]?.original.path ?? index,
        overscan: 12,
    });

    useEffect(() => {
        if (focusIndex < 0 || !bodyRef.current || !osRef) {
            return;
        }

        rowVirtualizer.scrollToIndex(focusIndex, { align: "auto" });
        const rowElement = bodyRef.current.querySelector(`[data-rowindex="${focusIndex}"]`) as HTMLDivElement;
        if (!rowElement) {
            return;
        }

        const viewport = osRef.osInstance().elements().viewport;
        const viewportHeight = viewport.offsetHeight;
        const rowRect = rowElement.getBoundingClientRect();
        const parentRect = viewport.getBoundingClientRect();
        const viewportScrollTop = viewport.scrollTop;
        const rowTopRelativeToViewport = rowRect.top - parentRect.top + viewport.scrollTop;
        const rowBottomRelativeToViewport = rowRect.bottom - parentRect.top + viewport.scrollTop;

        if (rowTopRelativeToViewport - 30 < viewportScrollTop) {
            // Row is above the visible area
            let topVal = rowTopRelativeToViewport - 30;
            if (topVal < 0) {
                topVal = 0;
            }
            viewport.scrollTo({ top: topVal });
        } else if (rowBottomRelativeToViewport + 5 > viewportScrollTop + viewportHeight) {
            // Row is below the visible area
            const topVal = rowBottomRelativeToViewport - viewportHeight + 5;
            viewport.scrollTo({ top: topVal });
        }
    }, [focusIndex]);

    const handleFileContextMenu = useCallback(
        async (e: any, finfo: FileInfo) => {
            e.preventDefault();
            e.stopPropagation();
            if (finfo == null) {
                return;
            }
            const fileName = finfo.name || getPreviewFileName(finfo.path, conn);
            const quotingLabel = isLocalWindowsFilePath(finfo.path, conn) ? "PowerShell Quoted" : "Shell Quoted";
            // the ".." row points at the parent directory; rename/delete on it would act on the parent
            const isParentRow = isParentDirEntry(finfo);
            const menu: ContextMenuItem[] = [
                {
                    label: "New File",
                    click: () => {
                        table.options.meta.newFile();
                    },
                },
                {
                    label: "New Folder",
                    click: () => {
                        table.options.meta.newDirectory();
                    },
                },
            ];
            if (!isParentRow) {
                menu.push({
                    label: "Rename",
                    click: () => {
                        table.options.meta.updateName(finfo.path, finfo.isdir);
                    },
                });
            }
            menu.push(
                {
                    type: "separator",
                },
                {
                    label: "Copy File Name",
                    click: () => fireAndForget(() => navigator.clipboard.writeText(fileName)),
                },
                {
                    label: "Copy Full File Name",
                    click: () => fireAndForget(() => navigator.clipboard.writeText(finfo.path)),
                },
                {
                    label: `Copy File Name (${quotingLabel})`,
                    click: () =>
                        fireAndForget(() =>
                            navigator.clipboard.writeText(quotePreviewFilePath(fileName, finfo.path, conn))
                        ),
                },
                {
                    label: `Copy Full File Name (${quotingLabel})`,
                    click: () =>
                        fireAndForget(() =>
                            navigator.clipboard.writeText(quotePreviewFilePath(finfo.path, finfo.path, conn))
                        ),
                }
            );
            addOpenMenuItems(menu, conn, finfo);
            menu.push(
                {
                    type: "separator",
                },
                {
                    label: "Default Settings",
                    submenu: makeDirectoryDefaultMenuItems(model),
                }
            );
            if (!isParentRow) {
                menu.push(
                    {
                        type: "separator",
                    },
                    {
                        label: "Delete",
                        click: () => confirmFileDelete(model, finfo, setErrorMsg),
                    }
                );
            }
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [setRefreshVersion, conn]
    );

    return (
        <div className="dir-table-body" ref={bodyRef}>
            {(searchActive || search !== "") && (
                <div className="flex rounded-[3px] py-1 px-2 bg-warning text-black" ref={warningBoxRef}>
                    <span>{search === "" ? "Type to search (Esc to cancel)" : `Searching for "${search}"`}</span>
                    <div
                        className="ml-auto bg-transparent flex justify-center items-center flex-col p-0.5 rounded-md hover:bg-hoverbg focus:bg-hoverbg focus-within:bg-hoverbg cursor-pointer"
                        onClick={() => {
                            setSearch("");
                            globalStore.set(model.directorySearchActive, false);
                        }}
                    >
                        <i className="fa-solid fa-xmark" />
                        <input
                            data-directory-search-input
                            type="text"
                            value={search}
                            onChange={() => {}}
                            className="w-0 h-0 opacity-0 p-0 border-none pointer-events-none"
                        />
                    </div>
                </div>
            )}
            <div className="dir-table-body-scroll-box" style={{ height: rowVirtualizer.getTotalSize() }}>
                <div className="dummy dir-table-body-row" ref={dummyLineRef}>
                    <div className="dir-table-body-cell">dummy-data</div>
                </div>
                {rowVirtualizer.getVirtualItems().map((item) => {
                    const row = rows[item.index];
                    return (
                        <div
                            key={row.original.path}
                            data-index={item.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                                position: "absolute",
                                top: 0,
                                width: "100%",
                                transform: `translateY(${item.start}px)`,
                            }}
                        >
                            <TableRow
                                selected={selectedPaths.has(row.original.path)}
                                onSelect={(event) => onSelect(row.original, visibleFiles, event)}
                                model={model}
                                row={row}
                                focusIndex={focusIndex}
                                setFocusIndex={setFocusIndex}
                                setSearch={setSearch}
                                idx={item.index}
                                handleFileContextMenu={handleFileContextMenu}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

type TableRowProps = {
    selected: boolean;
    onSelect: (event: React.MouseEvent) => void;
    model: PreviewModel;
    row: Row<FileInfo>;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    idx: number;
    handleFileContextMenu: (e: any, finfo: FileInfo) => Promise<void>;
};

function TableRow({
    selected,
    onSelect,
    model,
    row,
    focusIndex,
    setFocusIndex,
    setSearch,
    idx,
    handleFileContextMenu,
}: TableRowProps) {
    const dirPath = useAtomValue(model.statFilePath);
    const connection = useAtomValue(model.connection);

    const dragItem = useMemo<DraggedFile>(
        () => ({
            relName: row.getValue("name") as string,
            absParent: dirPath,
            path: row.getValue("path") as string,
            uri: formatRemoteUri(row.getValue("path") as string, connection),
            isDir: row.original.isdir,
        }),
        [row.original.path, row.original.isdir, dirPath, connection]
    );
    const [_, drag] = useDrag(
        () => ({
            type: "FILE_ITEM",
            canDrag: !isParentDirEntry(row.original),
            item: () => dragItem,
        }),
        [dragItem, row.original]
    );

    const dragRef = useCallback(
        (node: HTMLDivElement | null) => {
            drag(node);
        },
        [drag]
    );

    return (
        <div
            className={cn("dir-table-body-row cursor-pointer select-none", { focused: focusIndex === idx, selected })}
            aria-selected={selected}
            role="row"
            data-rowindex={idx}
            onDoubleClick={() => {
                const newFileName = row.getValue("path") as string;
                model.goHistory(newFileName);
                setSearch("");
                globalStore.set(model.directorySearchActive, false);
            }}
            onClick={(event) => {
                setFocusIndex(idx);
                onSelect(event);
            }}
            onContextMenu={(e) => handleFileContextMenu(e, row.original)}
            ref={dragRef}
        >
            {row.getVisibleCells().map((cell) => (
                <div
                    className={cn("dir-table-body-cell", "col-" + cell.column.id)}
                    key={cell.id}
                    title={cell.column.id === "mimetype" ? row.original.mimetype : undefined}
                    style={{ width: `calc(var(--col-${cell.column.id}-size) * 1px)` }}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    );
}

const MemoizedTableBody = React.memo(TableBody, (prev, next) => prev.table.options.data == next.table.options.data);
MemoizedTableBody.displayName = "MemoizedTableBody";

interface DirectoryPreviewProps {
    model: PreviewModel;
}

function DirectoryPreview({ model }: DirectoryPreviewProps) {
    const env = useWaveEnv<PreviewEnv>();
    const [searchText, setSearchText] = useState("");
    const [focusIndex, setFocusIndex] = useState(-1);
    const [unfilteredData, setUnfilteredData] = useState<FileInfo[]>([]);
    const showHiddenFiles = useAtomValue(model.showHiddenFiles);
    const treeViewMode = useAtomValue(model.treeViewMode);
    const fileView = useAtomValue(env.getSettingsKeyAtom("preview:fileview")) ?? "list";
    const [selectedPath, setSelectedPath] = useState("");
    const [selection, setSelection] = useState<DirectorySelection>({ files: [], anchor: null });
    const [copyOpen, setCopyOpen] = useState(false);
    const [copyFolder, setCopyFolder] = useState("");
    const [copyConnection, setCopyConnection] = useState("");
    const [batchBusy, setBatchBusy] = useState(false);
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const onSelect = useCallback((entry: FileInfo, visible: FileInfo[], modifiers: SelectionModifiers) => {
        setSelection((current) => selectDirectoryEntry(current, entry, visible, modifiers));
    }, []);
    useEffect(() => {
        setSelection({ files: [], anchor: null });
    }, [searchText, showHiddenFiles, fileView]);
    const [refreshVersion, setRefreshVersion] = useAtom(model.refreshVersion);
    const [isLocalDragOver, setIsLocalDragOver] = useState(false);
    const conn = useAtomValue(model.connection);
    const blockData = useAtomValue(model.blockAtom);
    const finfo = useAtomValue(model.statFile);
    const dirPath = finfo?.path;
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const mountAbortRef = useRef<AbortController>(null);

    useEffect(() => {
        const controller = new AbortController();
        mountAbortRef.current = controller;
        return () => {
            controller.abort();
        };
    }, []);

    useEffect(() => {
        model.refreshCallback = () => {
            setRefreshVersion((refreshVersion) => refreshVersion + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, [setRefreshVersion]);

    useEffect(() => {
        globalStore.set(model.treeViewMode, fileView == "tree");
    }, [fileView, model.treeViewMode]);

    useEffect(() => {
        let cancelled = false;
        setUnfilteredData([]);
        setFocusIndex(-1);
        setSelectedPath(null);
        setSelection({ files: [], anchor: null });
        fireAndForget(async () => {
            const entries: FileInfo[] = [];
            let lastPublishedCount = 0;
            let lastPublishedAt = Date.now();
            try {
                const remotePath = await model.formatRemoteUri(dirPath, globalStore.get);
                const stream = env.rpc.FileListStreamCommand(TabRpcClient, { path: remotePath }, null);
                for await (const chunk of stream) {
                    if (cancelled) {
                        break;
                    }
                    if (chunk?.fileinfo) {
                        entries.push(...chunk.fileinfo);
                    }
                    const now = Date.now();
                    if (entries.length - lastPublishedCount >= 500 || now - lastPublishedAt >= 100) {
                        setUnfilteredData([...entries]);
                        lastPublishedCount = entries.length;
                        lastPublishedAt = now;
                    }
                }
                if (finfo?.dir && finfo?.path !== finfo?.dir) {
                    entries.unshift({
                        name: "..",
                        path: finfo.dir,
                        isdir: true,
                        modtime: new Date().getTime(),
                        mimetype: "directory",
                    });
                }
            } catch (e) {
                if (!cancelled) {
                    console.error("Directory Read Error", e);
                    setErrorMsg({
                        status: "Cannot Read Directory",
                        text: `${e}`,
                    });
                }
            }
            if (!cancelled) {
                setUnfilteredData(entries);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [conn, dirPath, refreshVersion]);

    const filteredData = useMemo(
        () =>
            unfilteredData?.filter((fileInfo) => {
                if (fileInfo.name == null) {
                    console.log("fileInfo.name is null", fileInfo);
                    return false;
                }
                if (!showHiddenFiles && fileInfo.name.startsWith(".") && fileInfo.name != "..") {
                    return false;
                }
                return fileInfo.name.toLowerCase().includes(searchText.toLowerCase());
            }) ?? [],
        [unfilteredData, showHiddenFiles, searchText]
    );

    useEffect(() => {
        model.directoryKeyDownHandler = (waveEvent: WaveKeyboardEvent): boolean => {
            if (checkKeyPressed(waveEvent, "Cmd:f")) {
                globalStore.set(model.directorySearchActive, true);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Escape")) {
                setSelection({ files: [], anchor: null });
                setCopyOpen(false);
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                return;
            }
            if (checkKeyPressed(waveEvent, "Cmd:a")) {
                setSelection({ files: filteredData.filter((file) => !isParentDirEntry(file)), anchor: null });
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowUp")) {
                setFocusIndex((idx) =>
                    getDirectoryFocusIndex(idx, filteredData.length, -1, filteredData.some(isParentDirEntry))
                );
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowDown")) {
                setFocusIndex((idx) =>
                    getDirectoryFocusIndex(idx, filteredData.length, 1, filteredData.some(isParentDirEntry))
                );
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageUp")) {
                setFocusIndex((idx) =>
                    getDirectoryFocusIndex(idx, filteredData.length, -PageJumpSize, filteredData.some(isParentDirEntry))
                );
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageDown")) {
                setFocusIndex((idx) =>
                    getDirectoryFocusIndex(idx, filteredData.length, PageJumpSize, filteredData.some(isParentDirEntry))
                );
                return true;
            }
            if (checkKeyPressed(waveEvent, "Enter")) {
                if (filteredData.length == 0) {
                    return;
                }
                if (selectedPath == null) {
                    setFocusIndex(
                        getDirectoryFocusIndex(-1, filteredData.length, 1, filteredData.some(isParentDirEntry))
                    );
                    return true;
                }
                model.goHistory(selectedPath);
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Backspace")) {
                if (searchText.length == 0) {
                    return true;
                }
                setSearchText((current) => current.slice(0, -1));
                return true;
            }
            if (
                checkKeyPressed(waveEvent, "Space") &&
                searchText == "" &&
                PLATFORM == PlatformMacOS &&
                !blockData?.meta?.connection
            ) {
                if (selectedPath != null) env.electron.onQuicklook(selectedPath);
                return true;
            }
            if (isCharacterKeyEvent(waveEvent)) {
                setSearchText((current) => current + waveEvent.key);
                return true;
            }
            return false;
        };
        return () => {
            model.directoryKeyDownHandler = null;
        };
    }, [filteredData, selectedPath, searchText]);

    useEffect(() => {
        if (focusIndex > filteredData.length - 1) {
            setFocusIndex(filteredData.length - 1);
        }
    }, [filteredData]);

    const entryManagerPropsAtom = useState(
        atom<EntryManagerOverlayProps>(null) as PrimitiveAtom<EntryManagerOverlayProps>
    )[0];
    const [entryManagerProps, setEntryManagerProps] = useAtom(entryManagerPropsAtom);

    const { refs, floatingStyles, context } = useFloating({
        open: !!entryManagerProps,
        onOpenChange: () => setEntryManagerProps(undefined),
        middleware: [offset(({ rects }) => -rects.reference.height / 2 - rects.floating.height / 2)],
    });

    const handleDropCopy = useCallback(
        async (
            data: CommandFileCopyData,
            itemType: TransferItemType,
            signal?: AbortSignal,
            refresh = true
        ): Promise<FileCopyResult> => {
            return copyWithOverwriteConfirmation(data, itemType, {
                copyFile: (nextData) =>
                    env.rpc.FileCopyCommand(TabRpcClient, nextData, { timeout: nextData.opts?.timeout }),
                refresh: refresh ? () => model.refreshCallback?.() : undefined,
                setErrorMsg,
                watchErrorMsg: (listener) =>
                    globalStore.sub(model.errorMsgAtom, () => listener(globalStore.get(model.errorMsgAtom))),
                signal: signal ?? mountAbortRef.current?.signal,
            });
        },
        [env.rpc, model.refreshCallback, model.errorMsgAtom, setErrorMsg]
    );

    // RPC copies cannot be interrupted mid-flight, so a cancel only takes effect before the copy starts or while it
    // is waiting on the overwrite prompt; otherwise the real outcome of the copy is reported.
    const runTrackedUpload = useCallback(
        async (jobId: string, itemType: TransferItemType, data: CommandFileCopyData, refresh = true): Promise<void> => {
            const started = await env.electron.beginTransferJob(jobId);
            if (!started) {
                return;
            }
            const controller = new AbortController();
            const mountSignal = mountAbortRef.current?.signal;
            const abortUpload = () => controller.abort();
            if (mountSignal?.aborted) {
                controller.abort();
            }
            mountSignal?.addEventListener("abort", abortUpload);
            const stopWatching = env.electron.onTransferQueueUpdate((queue) => {
                const job = queue?.jobs.find((candidate) => candidate.id === jobId);
                if (job?.cancelRequestedAt != null || job?.status === "canceled") {
                    controller.abort();
                }
            });
            let outcome: TransferJobOutcome;
            try {
                outcome = toUploadOutcome(await handleDropCopy(data, itemType, controller.signal, refresh));
            } catch (e) {
                outcome = { status: "failed", error: makeUploadFailure(`${e}`, true) };
            } finally {
                stopWatching?.();
                mountSignal?.removeEventListener("abort", abortUpload);
            }
            await env.electron.finishTransferJob(jobId, outcome);
        },
        [env.electron, handleDropCopy]
    );

    const retryUpload = useCallback(
        async (job: TransferJob): Promise<void> => {
            const lastSeparator = job.destination.lastIndexOf("/");
            if (lastSeparator < job.destination.indexOf("://") + 3) {
                if (await env.electron.beginTransferJob(job.id)) {
                    await env.electron.finishTransferJob(job.id, {
                        status: "failed",
                        error: makeUploadFailure("Invalid remote destination.", false),
                    });
                }
                return;
            }
            await runTrackedUpload(job.id, job.itemType, {
                srcuri: job.source,
                desturi: job.destination.slice(0, lastSeparator + 1),
                opts: { timeout: CopyTimeoutYear, recursive: job.itemType === "folder" },
            });
        },
        [env.electron, runTrackedUpload]
    );

    const downloadSelected = async () => {
        setBatchBusy(true);
        try {
            await env.electron.downloadFiles(
                getTransferSelection(selection.files).map((file) => ({
                    path: formatRemoteUri(file.path, conn),
                    isdir: !!file.isdir,
                }))
            );
        } catch (error) {
            setErrorMsg({ status: "Download failed", text: String(error), level: "error" });
        } finally {
            setBatchBusy(false);
        }
    };

    const copySelected = async () => {
        setBatchBusy(true);
        try {
            const files = getTransferSelection(selection.files);
            if (files.length > 200) throw new Error("Select at most 200 items per transfer.");
            const destination = await env.rpc.FileInfoCommand(TabRpcClient, {
                info: { path: formatRemoteUri(copyFolder.trim(), copyConnection || "local") },
            });
            if (!destination?.isdir) throw new Error("Choose an existing destination folder.");
            const destinationPath = destination.path.replace(/\/+$/, "");
            const desturi = formatRemoteUri(destinationPath + "/", copyConnection || "local");
            if (
                (conn || "local") === (copyConnection || "local") &&
                files.some((file) => {
                    const source = file.path.replace(/\/+$/, "");
                    return (
                        `${destinationPath}/${file.name}` === source ||
                        (file.isdir && (destinationPath === source || destinationPath.startsWith(source + "/")))
                    );
                })
            )
                throw new Error(
                    "Choose a different folder; selected items cannot be copied onto themselves or into their own folders."
                );
            const groupId = createUploadTransferGroupId("copy");
            const jobs = files.map((file) => ({
                id: createUploadTransferJobId("copy"),
                operation: "copy" as const,
                itemType: file.isdir ? ("folder" as const) : ("file" as const),
                transport: "wsh" as const,
                source: formatRemoteUri(file.path, conn),
                destination: `${desturi}${file.name}`,
                label: file.name,
                groupId,
            }));
            await env.electron.enqueueTransferJobs(jobs);
            for (const job of jobs) {
                await runTrackedUpload(
                    job.id,
                    job.itemType,
                    {
                        srcuri: job.source,
                        desturi,
                        opts: { timeout: CopyTimeoutYear, recursive: job.itemType === "folder" },
                    },
                    false
                );
            }
            model.refreshCallback?.();
            setCopyOpen(false);
        } catch (error) {
            setErrorMsg({ status: "Copy failed", text: String(error), level: "error" });
        } finally {
            setBatchBusy(false);
        }
    };

    const buildLocalUploadItems = useCallback(
        (dataTransfer: DataTransfer): LocalUploadItem[] =>
            Array.from(dataTransfer.files)
                .map((file, index): LocalUploadItem | null => {
                    const localPath = env.electron.getPathForFile(file);
                    if (!localPath) {
                        return null;
                    }
                    return {
                        path: localPath,
                        name: file.name,
                        itemType: getDroppedItemType(dataTransfer, index),
                    };
                })
                .filter((item): item is LocalUploadItem => item != null),
        [env.electron]
    );

    const handleLocalUploadDrop = useCallback(
        async (dataTransfer: DataTransfer, targetDir: string = dirPath) => {
            const uploadItems = buildLocalUploadItems(dataTransfer);
            if (uploadItems.length === 0) {
                setErrorMsg({
                    status: "Upload Failed",
                    text: "No local file paths were available from the drop.",
                    level: "error",
                });
                return;
            }

            try {
                const desturi = await model.formatRemoteUri(targetDir, globalStore.get);
                const groupId = uploadItems.length > 1 ? createUploadTransferGroupId("upload") : undefined;
                const plans = buildLocalUploadTransferPlans(uploadItems, desturi, {
                    groupId,
                    createId: () => createUploadTransferJobId("upload"),
                });

                await env.electron.enqueueTransferJobs(plans.map((plan) => plan.jobInput));
                for (const plan of plans) {
                    try {
                        await runTrackedUpload(plan.jobInput.id, plan.jobInput.itemType, {
                            srcuri: plan.srcuri,
                            desturi: plan.desturi,
                            opts: {
                                timeout: CopyTimeoutYear,
                            },
                        });
                    } catch (e) {
                        console.error("Upload transfer tracking failed", e);
                    }
                }
            } catch (e) {
                setErrorMsg({
                    status: "Upload Failed",
                    text: `${e}`,
                    level: "error",
                });
            }
        },
        [buildLocalUploadItems, dirPath, env.electron, runTrackedUpload, model.formatRemoteUri, setErrorMsg]
    );

    const handleLocalDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        if (!hasNativeFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setIsLocalDragOver(true);
    }, []);

    const handleLocalDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        if (!hasNativeFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setIsLocalDragOver(true);
    }, []);

    const handleLocalDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        if (!hasNativeFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            setIsLocalDragOver(false);
        }
    }, []);

    const handleLocalDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            if (!hasNativeFiles(e.dataTransfer) || e.dataTransfer.files.length === 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const { dataTransfer } = e;
            setIsLocalDragOver(false);
            fireAndForget(() => handleLocalUploadDrop(dataTransfer));
        },
        [handleLocalUploadDrop]
    );

    const [, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM", //a name of file drop type
            canDrop: (_, monitor) => {
                const dragItem = monitor.getItem<DraggedFile>();
                // drop if not current dir is the parent directory of the dragged item
                // requires absolute path
                if (monitor.isOver({ shallow: false }) && dragItem.absParent !== dirPath) {
                    return true;
                }
                return false;
            },
            drop: async (draggedFile: DraggedFile, monitor) => {
                if (!monitor.didDrop()) {
                    const opts: FileCopyOpts = {
                        timeout: CopyTimeoutYear,
                    };
                    const desturi = await model.formatRemoteUri(dirPath, globalStore.get);
                    const data: CommandFileCopyData = {
                        srcuri: draggedFile.uri,
                        desturi,
                        opts,
                    };
                    await handleDropCopy(data, draggedFile.isDir ? "folder" : "file");
                }
            },
            // TODO: mabe add a hover option?
        }),
        [dirPath, model.formatRemoteUri, model.refreshCallback]
    );

    useEffect(() => {
        drop(refs.reference);
    }, [refs.reference]);

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const newFile = useCallback(() => {
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewFile,
            onSave: (newName: string) => {
                console.log(`newFile: ${newName}`);
                fireAndForget(async () => {
                    await env.rpc.FileCreateCommand(
                        TabRpcClient,
                        {
                            info: {
                                path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                            },
                        },
                        null
                    );
                    model.refreshCallback();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath]);
    const newDirectory = useCallback(() => {
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewDirectory,
            onSave: (newName: string) => {
                console.log(`newDirectory: ${newName}`);
                fireAndForget(async () => {
                    await env.rpc.FileMkdirCommand(TabRpcClient, {
                        info: {
                            path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                        },
                    });
                    model.refreshCallback();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath]);

    const handleFileContextMenu = useCallback(
        (e: any) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: "New File",
                    click: () => {
                        newFile();
                    },
                },
                {
                    label: "New Folder",
                    click: () => {
                        newDirectory();
                    },
                },
                {
                    type: "separator",
                },
            ];
            addOpenMenuItems(menu, conn, finfo, { terminalCwd: dirPath });

            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [setRefreshVersion, conn, newFile, newDirectory, dirPath]
    );

    return (
        <Fragment>
            <div
                ref={refs.setReference}
                className="dir-table-container"
                onChangeCapture={(e) => {
                    const event = e as React.ChangeEvent<HTMLInputElement>;
                    if (!entryManagerProps && event.target.hasAttribute("data-directory-search-input")) {
                        setSearchText(event.target.value.toLowerCase());
                    }
                }}
                {...getReferenceProps()}
                onContextMenu={(e) => handleFileContextMenu(e)}
                onClick={() => setEntryManagerProps(undefined)}
                onDragEnter={treeViewMode ? undefined : handleLocalDragEnter}
                onDragOver={treeViewMode ? undefined : handleLocalDragOver}
                onDragLeave={treeViewMode ? undefined : handleLocalDragLeave}
                onDrop={treeViewMode ? undefined : handleLocalDrop}
            >
                {!treeViewMode && isLocalDragOver && <DirectoryUploadDropOverlay />}
                <DirectoryTransferQueueStatus onRetryUpload={retryUpload} />
                {selection.files.length > 0 && (
                    <div
                        className="flex shrink-0 flex-col gap-2 border-b border-border bg-accent/5 px-3 py-2"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-secondary mr-auto" aria-live="polite">
                                {selection.files.length} selected
                            </span>
                            {!!conn && (
                                <button
                                    className="cursor-pointer rounded px-2 py-1 hover:bg-hoverbg disabled:opacity-40"
                                    disabled={batchBusy}
                                    onClick={() => void downloadSelected()}
                                >
                                    <i aria-hidden="true" className="fa-solid fa-download mr-1" />
                                    Download
                                </button>
                            )}
                            <button
                                className="cursor-pointer rounded px-2 py-1 hover:bg-hoverbg disabled:opacity-40"
                                disabled={batchBusy}
                                onClick={() => {
                                    setCopyOpen(!copyOpen);
                                    setCopyConnection(conn || "");
                                    setCopyFolder(dirPath || "~");
                                }}
                            >
                                <i aria-hidden="true" className="fa-regular fa-copy mr-1" />
                                Copy to…
                            </button>
                            <button
                                className="cursor-pointer rounded px-2 py-1 hover:bg-hoverbg"
                                aria-label="Clear selection"
                                onClick={() => {
                                    setSelection({ files: [], anchor: null });
                                    setCopyOpen(false);
                                }}
                            >
                                <i className="fa-solid fa-xmark" />
                            </button>
                        </div>
                        {copyOpen && (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <select
                                    aria-label="Copy destination host"
                                    className="min-w-24 rounded border border-border bg-panel px-2 py-1"
                                    value={copyConnection}
                                    onChange={(event) => setCopyConnection(event.target.value)}
                                >
                                    <option value="">Local</option>
                                    {Array.from(new Set([conn, ...Object.keys(fullConfig?.connections ?? {})]))
                                        .filter(Boolean)
                                        .map((host) => (
                                            <option key={host} value={host}>
                                                {host}
                                            </option>
                                        ))}
                                </select>
                                <input
                                    aria-label="Copy destination folder"
                                    className="min-w-32 flex-1 rounded border border-border bg-transparent px-2 py-1 outline-none focus:border-accent"
                                    value={copyFolder}
                                    onChange={(event) => setCopyFolder(event.target.value)}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    placeholder="Destination folder"
                                />
                                <button
                                    className="bg-accent/80 text-primary rounded hover:bg-accent transition-colors cursor-pointer px-2 py-1 disabled:opacity-40"
                                    disabled={batchBusy || !copyFolder.trim()}
                                    onClick={() => void copySelected()}
                                >
                                    {batchBusy ? "Copying…" : "Copy selected"}
                                </button>
                            </div>
                        )}
                    </div>
                )}
                {treeViewMode ? (
                    <DirectoryTreeView
                        selection={selection}
                        onSelect={onSelect}
                        model={model}
                        data={filteredData}
                        rootDir={dirPath}
                        refreshVersion={refreshVersion}
                        onUploadFiles={handleLocalUploadDrop}
                    />
                ) : (
                    <DirectoryTable
                        selection={selection}
                        onSelect={onSelect}
                        model={model}
                        data={filteredData}
                        search={searchText}
                        focusIndex={focusIndex}
                        setFocusIndex={setFocusIndex}
                        setSearch={setSearchText}
                        setSelectedPath={setSelectedPath}
                        setRefreshVersion={setRefreshVersion}
                        entryManagerOverlayPropsAtom={entryManagerPropsAtom}
                        newFile={newFile}
                        newDirectory={newDirectory}
                    />
                )}
            </div>
            {entryManagerProps && (
                <EntryManagerOverlay
                    {...entryManagerProps}
                    forwardRef={refs.setFloating}
                    style={floatingStyles}
                    getReferenceProps={getFloatingProps}
                    onCancel={() => setEntryManagerProps(undefined)}
                />
            )}
        </Fragment>
    );
}

export { DirectoryPreview };
