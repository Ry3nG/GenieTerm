// Copyright 2026, GenieTerm. Apache-2.0.

document.documentElement.classList.remove("no-js");
for (const button of document.querySelectorAll("button[disabled]")) button.disabled = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function selectButton(group, selected) {
    for (const button of $$(group)) {
        button.setAttribute("aria-pressed", String(button === selected));
    }
}

const SessionStates = {
    connected: {
        laptop: "Connected",
        wire: "SSH",
        title: "Your shell is attached.",
        description: "The process runs on atlas. GenieTerm shows its output on your laptop.",
        output: "Epoch 21/50 · checkpoint saved\nEpoch 22/50 · training…",
    },
    away: {
        laptop: "Asleep",
        wire: "DISCONNECTED",
        title: "The connection pauses. The process continues.",
        description: "Your durable session stays on atlas. New output is buffered while your laptop is away.",
        output: "Epoch 23/50 · checkpoint saved\nEpoch 24/50 · training…",
    },
    back: {
        laptop: "Reattached",
        wire: "OUTPUT RESTORED",
        title: "Pick up where the host is now.",
        description: "GenieTerm reattaches to the same session and streams back the output you missed.",
        output: "Epoch 23/50 · checkpoint saved\nEpoch 24/50 · training…",
    },
};

for (const button of $$("[data-session-step]")) {
    button.addEventListener("click", () => {
        const step = button.dataset.sessionStep;
        const state = SessionStates[step];
        selectButton("[data-session-step]", button);
        $("[data-session]").dataset.session = step;
        $("[data-laptop-status]").textContent = state.laptop;
        $("[data-wire-label]").textContent = state.wire;
        $("[data-session-title]").textContent = state.title;
        $("[data-session-description]").textContent = state.description;
        $("[data-session-output]").textContent = state.output;
    });
}

$("[data-forward]").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const active = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active ? "Reset example ↶" : "Open in Browser ↗";
    $("[data-browser-preview]").hidden = !active;
    $("[data-port-route]").classList.toggle("is-forwarded", active);
    $("[data-route-label]").textContent = active ? "atlas:6006 → localhost:6006" : "Remote port 6006";
    $("[data-forward-status]").textContent = active
        ? "Example forwarded. In GenieTerm, the service opens in your browser through a local-only SSH forward."
        : "Try the example. No connection is made from this page.";
});

const AiExamples = {
    write: {
        question: "Find the log files in this project's runs folder.",
        summary: "Find every .log file under ./runs, including subfolders.",
        command: "find ./runs -type f -name '*.log'",
        risk: "Read-only command",
    },
    fix: {
        question: "tensorboard: command not found · exit 127",
        summary:
            "TensorBoard isn't available in this shell. Install it in your active Python environment, then try again.",
        command: "python -m pip install tensorboard",
        risk: "Installs a package",
    },
    explain: {
        question: "What does du -sh ./runs do?",
        summary: "Show the total disk space used by ./runs. The -s flag gives one total; -h makes the size readable.",
        command: "du -sh ./runs",
        risk: "Read-only command",
    },
};
let selectedExample = "write";

for (const button of $$("[data-ai]")) {
    button.addEventListener("click", () => {
        selectedExample = button.dataset.ai;
        const example = AiExamples[selectedExample];
        selectButton("[data-ai]", button);
        $("[data-ai-question]").textContent = example.question;
        $("[data-ai-summary]").textContent = example.summary;
        $("[data-ai-command]").textContent = example.command;
        $("[data-ai-risk]").textContent = example.risk;
        $("[data-ai-prompt]").textContent = " ";
        $("[data-ai-status]").textContent = "Illustrative response. Try inserting it into the sample prompt.";
        $("[data-insert]").textContent = "Insert at prompt ↙";
    });
}

$("[data-insert]").addEventListener("click", () => {
    $("[data-ai-prompt]").textContent = AiExamples[selectedExample].command;
    $("[data-ai-status]").textContent = "Inserted into the example prompt. Nothing has been executed.";
    $("[data-insert]").textContent = "Inserted ✓";
});

const platform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
const os = platform.includes("mac")
    ? "mac"
    : platform.includes("win")
      ? "windows"
      : platform.includes("linux")
        ? "linux"
        : null;
if (os) {
    $(`[data-platform="${os}"]`)?.classList.add("is-detected");
    if (os !== "windows") {
        $("[data-cta-label]").textContent = `Download for ${os === "mac" ? "macOS" : "Linux"}`;
        $("[data-download-cta]").setAttribute("aria-label", `Download for ${os === "mac" ? "macOS" : "Linux"}`);
    }
}

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
        ) {
            throw new Error("No stable release");
        }
        const releaseUrl = githubUrl(release.html_url, "/Ry3nG/GenieTerm/releases/tag/");
        if (!releaseUrl) throw new Error("Invalid release URL");
        $("[data-version]").textContent = release.tag_name;
        $(".release-link").href = releaseUrl;
        let resolved = 0;
        for (const link of $$("[data-asset]")) {
            const asset = release.assets.find((item) => new RegExp(link.dataset.asset, "i").test(item.name));
            const url = asset && githubUrl(asset.browser_download_url, "/Ry3nG/GenieTerm/releases/download/");
            if (!url) continue;
            link.href = url;
            resolved++;
        }
        $("[data-release-status]").textContent =
            resolved === $$("[data-asset]").length
                ? `${release.tag_name} · Free downloads for macOS and Linux.`
                : `${release.tag_name} · Some packages link to GitHub Releases for availability.`;
    } catch {
        $("[data-release-status]").textContent =
            "Downloads: v1.4.0. Visit GitHub Releases to check for a newer version.";
    } finally {
        clearTimeout(timeout);
    }
}

loadRelease();

const ProductViews = {
    host: {
        src: "img/host-overview.png",
        caption: "Your machine, beyond the prompt.",
        alt: "GenieTerm Host overview showing GPUs, CPU, memory and processes",
    },
    files: {
        src: "img/files.jpg",
        caption: "Find it. Open it. Keep working.",
        alt: "GenieTerm Files view with a project's folders, Python files and results",
    },
    ai: {
        src: "img/command-ai.jpg",
        caption: "Understand the error. Review the next step.",
        alt: "Command AI explaining a build failure and proposing commands to review",
    },
};
const HostViews = {
    overview: {
        src: "img/host-overview.png",
        caption: "Every NVIDIA GPU, its memory, and the processes holding it.",
        alt: "Host overview with GPU, CPU and memory charts",
    },
    detail: {
        src: "img/host-detail.jpg",
        caption: "Go deeper: clocks, power, bandwidth and the processes using this GPU.",
        alt: "GPU detail showing history charts, temperature, power and owning processes",
    },
    ports: {
        src: "img/host-ports.jpg",
        caption: "Listening services and local forwards, in one place.",
        alt: "Host Ports view with TensorBoard, Jupyter, Ray and PostgreSQL",
    },
};
for (const button of $$("[data-gallery]")) {
    button.addEventListener("click", () => {
        const view = ProductViews[button.dataset.gallery];
        selectButton("[data-gallery]", button);
        $("[data-gallery-image]").src = view.src;
        $("[data-gallery-image]").alt = view.alt;
        $("[data-gallery-caption]").textContent = view.caption;
    });
}
for (const button of $$("[data-host-view]")) {
    button.addEventListener("click", () => {
        const view = HostViews[button.dataset.hostView];
        selectButton("[data-host-view]", button);
        $("[data-host-image]").src = view.src;
        $("[data-host-image]").alt = view.alt;
        $("[data-host-caption]").textContent = view.caption;
    });
}
const screenshotDialog = $(".image-dialog");
for (const button of $$("[data-expand]")) {
    button.addEventListener("click", () => {
        const source = button.querySelector("img");
        $("[data-dialog-image]").src = source.src;
        $("[data-dialog-image]").alt = source.alt;
        $("[data-dialog-title]").textContent = source.alt;
        screenshotDialog.showModal();
    });
}
$("[data-close-dialog]").addEventListener("click", () => screenshotDialog.close());
screenshotDialog.addEventListener("click", (event) => {
    if (event.target !== screenshotDialog) return;
    const bounds = screenshotDialog.getBoundingClientRect();
    if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
    )
        screenshotDialog.close();
});

const filmDialog = $(".film-dialog");
const filmVideo = filmDialog.querySelector("video");
for (const button of $$("[data-play-film]")) {
    button.addEventListener("click", () => {
        filmDialog.showModal();
        filmVideo.play().catch(() => {});
    });
}
$("[data-close-film]").addEventListener("click", () => filmDialog.close());
filmDialog.addEventListener("close", () => filmVideo.pause());
filmDialog.addEventListener("click", (event) => {
    if (event.target !== filmDialog) return;
    const bounds = filmDialog.getBoundingClientRect();
    if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
    )
        filmDialog.close();
});

const menuButton = $(".mobile-menu");
function closeNavigation() {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    $("#site-nav").removeAttribute("data-open");
}
menuButton.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    $("#site-nav").toggleAttribute("data-open", open);
});
for (const link of $$("#site-nav a")) link.addEventListener("click", closeNavigation);
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavigation();
});
document.addEventListener("click", (event) => {
    if (!$(".site-header").contains(event.target)) closeNavigation();
});
