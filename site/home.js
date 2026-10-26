// Copyright 2026, GenieTerm. Apache-2.0.
document.documentElement.classList.remove("no-js");
for (const button of document.querySelectorAll("button[disabled]")) button.disabled = false;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const Panes = {
    terminal: $("[data-terminal-pair]"),
    files: $("[data-static-view]"),
    host: $("[data-live-host]"),
    ai: $("[data-live-ai]"),
};
function selectView(name) {
    if (!Panes[name]) return;
    for (const tab of $$("[role=tab]")) {
        const active = tab.dataset.view === name;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
    }
    for (const [key, pane] of Object.entries(Panes)) pane.hidden = key !== name;
    const pane = Panes[name];
    if (pane.dataset.src && !pane.hasAttribute("src")) pane.src = pane.dataset.src;
    $("#ui-panel").setAttribute("aria-labelledby", "tab-" + name);
}
for (const tab of $$("[role=tab]")) tab.addEventListener("click", () => selectView(tab.dataset.view));
$(".view-tabs").addEventListener("keydown", (event) => {
    const tabs = $$("[role=tab]"),
        index = tabs.indexOf(document.activeElement);
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
selectView("terminal");
window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== Panes.ai.contentWindow) return;
    if (event.data?.type !== "genieterm:demo-height" || !Number.isFinite(event.data.height)) return;
    Panes.ai.style.height = `${Math.max(300, Math.min(850, event.data.height))}px`;
});
const Video = $("[data-film]"),
    Play = $("[data-play-film]");
Video.controls = false;
Play.hidden = false;
Play.addEventListener("click", () => {
    Video.controls = true;
    Play.hidden = true;
    Video.play().catch(() => {
        Play.hidden = false;
    });
});
Video.addEventListener("ended", () => {
    Video.controls = false;
    Play.hidden = false;
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
    const fallbackVersion = $("[data-version]").textContent.trim();
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
        $("[data-release-status]").textContent =
            "Stable downloads: " + fallbackVersion + ". Check GitHub Releases for newer versions.";
    } finally {
        clearTimeout(timeout);
    }
}
loadRelease();
