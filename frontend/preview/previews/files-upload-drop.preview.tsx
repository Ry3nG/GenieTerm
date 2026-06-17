import { DirectoryUploadDropOverlay } from "@/app/view/preview/directory-upload-drop-overlay";
import "@/app/view/preview/directorypreview.scss";

export function FilesUploadDropPreview() {
    return (
        <div className="flex flex-col gap-6 p-6 w-full max-w-[760px]">
            <div className="text-xs text-muted font-mono">Files upload drop affordance</div>
            <div
                className="dir-table-container rounded-md border border-border bg-panel overflow-hidden"
                style={{ height: 360 }}
            >
                <div className="dir-table">
                    <div className="dir-table-head">
                        <div className="dir-table-head-row">
                            <div className="dir-table-head-cell" style={{ width: 25 }} />
                            <div className="dir-table-head-cell" style={{ width: 170 }}>
                                <div className="dir-table-head-cell-content">Name</div>
                            </div>
                            <div className="dir-table-head-cell" style={{ width: 70 }}>
                                <div className="dir-table-head-cell-content">Perm</div>
                            </div>
                            <div className="dir-table-head-cell" style={{ width: 70 }}>
                                <div className="dir-table-head-cell-content">Modified</div>
                            </div>
                        </div>
                    </div>
                    <div className="dir-table-body">
                        <div className="dir-table-body-scroll-box">
                            {["reports", "release notes.txt", "screenshots"].map((name, idx) => (
                                <div className="dir-table-body-row" key={name}>
                                    <div className="dir-table-body-cell" style={{ width: 25 }}>
                                        <i className={idx === 0 ? "fa-solid fa-folder" : "fa-solid fa-file"} />
                                    </div>
                                    <div className="dir-table-body-cell" style={{ width: 170 }}>
                                        <span className="dir-table-name ellipsis">{name}</span>
                                    </div>
                                    <div className="dir-table-body-cell" style={{ width: 70 }}>
                                        <span className="dir-table-modestr">rw-r--r--</span>
                                    </div>
                                    <div className="dir-table-body-cell" style={{ width: 70 }}>
                                        <span className="dir-table-lastmod">Today</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <DirectoryUploadDropOverlay />
            </div>
        </div>
    );
}
