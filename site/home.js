// Copyright 2026, GenieTerm. Apache-2.0.
document.documentElement.classList.remove("no-js");
for (const button of document.querySelectorAll("button[disabled]")) button.disabled = false;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const Views = {
    terminal: {
        title: "Terminal",
        file: "terminal",
        source: "frontend/preview/previews/site-terminal.preview.tsx",
        alt: "GenieTerm's terminal renderer and reconnecting status component, with an example coding agent conversation",
    },
    files: {
        title: "Files",
        file: "files",
        source: "frontend/app/view/preview/preview-directory.tsx",
        alt: "GenieTerm's actual DirectoryPreview component with an example project",
    },
    host: {
        title: "Host",
        file: "host",
        source: "frontend/app/view/host/host.tsx",
        alt: "GenieTerm's actual Host component showing GPU utilization, CPU, memory and processes",
    },
    ai: {
        title: "Command AI",
        file: "command-ai",
        source: "frontend/app/view/term/command-composer-ui.tsx",
        alt: "GenieTerm's actual CommandAiSheet component explaining a build error and offering commands to review",
    },
};
let currentView = "host";
function showRender(file, alt) {
    const image = $("[data-ui-image]");
    image.src = `img/ui/${file}.svg`;
    image.alt = alt;
    $("[data-expand]").href = image.getAttribute("src");
}
function selectView(name) {
    const view = Views[name];
    if (!view) return;
    currentView = name;
    for (const tab of $$("[role=tab]")) {
        const selected = tab.dataset.view === name;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }
    $("#ui-panel").setAttribute("aria-labelledby", `tab-${name}`);
    $("[data-view-source]").href = "https://github.com/Ry3nG/GenieTerm/blob/main/" + view.source;
    $("[data-session-states]").hidden = name !== "terminal";
    for (const button of $$("[data-session-state]"))
        button.setAttribute("aria-pressed", String(button.dataset.sessionState === "terminal"));
    $("[data-expand]").setAttribute("aria-label", `Enlarge the ${view.title} interface`);
    showRender(view.file, view.alt);
}
for (const button of $$("[role=tab]")) button.addEventListener("click", () => selectView(button.dataset.view));
$(".view-tabs").addEventListener("keydown", (event) => {
    const tabs = $$("[role=tab]");
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    selectView(tabs[next].dataset.view);
});
for (const button of $$("[data-session-state]"))
    button.addEventListener("click", () => {
        for (const state of $$("[data-session-state]")) state.setAttribute("aria-pressed", String(state === button));
        showRender(
            button.dataset.sessionState,
            button.dataset.sessionState === "terminal"
                ? Views.terminal.alt
                : "The same generated agent session after reconnecting, with edits completed and 42 tests passing"
        );
    });
const Film = $(".film-dialog"),
    Video = Film.querySelector("video"),
    ImageDialog = $(".image-dialog");
$("[data-play-film]").addEventListener("click", (event) => {
    if (typeof Film.showModal !== "function") return;
    event.preventDefault();
    Film.showModal();
    Video.play().catch(() => {});
});
$("[data-close-film]").addEventListener("click", () => Film.close());
Film.addEventListener("close", () => Video.pause());
$("[data-expand]").addEventListener("click", (event) => {
    if (typeof ImageDialog.showModal !== "function") return;
    event.preventDefault();
    $("[data-enlarged-image]").src = $("[data-ui-image]").src;
    $("[data-enlarged-image]").alt = $("[data-ui-image]").alt;
    $("[data-image-title]").textContent = Views[currentView].title + " / product render";
    ImageDialog.showModal();
});
$("[data-close-image]").addEventListener("click", () => ImageDialog.close());
for (const dialog of [Film, ImageDialog])
    dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
            dialog.close();
    });
function githubUrl(value, pathPrefix) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith(pathPrefix)
            ? url.href
            : null;
    } catch {
        return null;
    }
}
async function loadRelease() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
        const response = await fetch("https://api.github.com/repos/Ry3nG/GenieTerm/releases/latest", {
            headers: { Accept: "application/vnd.github+json" },
            signal: controller.signal,
        });
        if (!response.ok) throw new Error("Release unavailable");
        const release = await response.json();
        if (
            !/^v?\d+\.\d+\.\d+$/.test(release.tag_name) ||
            release.draft ||
            release.prerelease ||
            !Array.isArray(release.assets)
        )
            throw new Error("No stable release");
        const releaseUrl = githubUrl(release.html_url, "/Ry3nG/GenieTerm/releases/tag/");
        if (!releaseUrl) throw new Error("Invalid release URL");
        $("[data-version]").textContent = release.tag_name;
        $(".release-link").href = releaseUrl;
        for (const link of $$("[data-asset]")) {
            const asset = release.assets.find((item) => new RegExp(link.dataset.asset, "i").test(item.name));
            const url = asset && githubUrl(asset.browser_download_url, "/Ry3nG/GenieTerm/releases/download/");
            if (url) link.href = url;
        }
        $("[data-release-status]").textContent = "Stable downloads: " + release.tag_name;
    } catch {
        $("[data-release-status]").textContent = "Stable downloads: v1.4.1. Check GitHub Releases for newer versions.";
    } finally {
        clearTimeout(timeout);
    }
}
loadRelease();
