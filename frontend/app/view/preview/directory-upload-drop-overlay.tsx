export function DirectoryUploadDropOverlay() {
    return (
        <div className="dir-upload-drop-overlay" aria-hidden="true">
            <div className="dir-upload-drop-panel">
                <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
                <span>Drop to upload</span>
            </div>
        </div>
    );
}
