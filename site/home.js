// Copyright 2026, GenieTerm. Apache-2.0.

document.documentElement.classList.remove("no-js");
for (const button of document.querySelectorAll("button[disabled]")) button.disabled = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const Demo = $("[data-demo]");
const SessionMarkup = Demo.innerHTML;
const Captions = {
    sessions: "Your connection can drop. Your work keeps running.",
    host: "Know what is running. Open what is listening.",
    files: "The remote project, right beside its shell.",
    ai: "Ask your AI. Review the command. Stay in control.",
};

function terminal(command, output, meta = "RUNNING") {
    return `<div class="terminal"><div class="pane-title"><span>Terminal</span><span>bash</span></div><div class="terminal-content"><div class="prompt"><span>~/vision-lab</span> $ ${command}</div><div class="command-meta">${meta}<span>atlas</span></div><pre class="terminal-output">${output}</pre><div class="terminal-cursor" aria-hidden="true">▌</div></div></div>`;
}

const HostMarkup =
    terminal(
        "tensorboard --logdir runs",
        'TensorFlow 2.20.0\nLog directory: ./runs\n\n<span class="terminal-green">TensorBoard 2.20.0 at\nhttp://localhost:6006/</span>\n\nWatching for new training events…'
    ) +
    `<div class="side-panel"><div class="pane-title"><span>Host / atlas</span><span>Overview</span></div>
<div class="host-metrics"><div class="metric"><span>CPU</span><strong>24<small>%</small></strong></div><div class="metric"><span>MEMORY</span><strong>18<small> / 64 GB</small></strong></div><div class="metric"><span>GPU</span><strong>87<small>%</small></strong></div></div>
<div class="gpu-chart"><div class="chart-heading">NVIDIA RTX 4090 <span>19.2 / 24 GB</span></div>
<svg viewBox="0 0 440 58" preserveAspectRatio="none" role="img" aria-label="GPU utilization over the last minute, rising to 87 percent"><path d="M0 55H440M0 28H440" fill="none" stroke="#364030" stroke-width="1"/><path d="M0 51L18 45L34 47L52 38L70 40L88 31L106 34L124 21L142 29L160 15L178 20L196 13L214 22L232 16L250 9L268 14L286 10L304 16L322 8L340 12L358 6L376 11L394 8L412 12L440 7" fill="none" stroke="#b9d88a" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>
<div class="port-row"><div>6006 <small>TensorBoard · localhost only</small></div><button data-forward aria-pressed="false">Forward port ↗</button></div><p class="port-result" data-port-result role="status"></p></div>`;

const FileContents = {
    "train.py":
        'import torch\nfrom model import make_model\n\nmodel = make_model("resnet50")\nmodel = model.to("cuda")\n\nfor epoch in range(50):\n    loss = train_epoch(model, loader)\n    save_checkpoint(model, epoch)',
    "configs/train.yaml":
        "model: resnet50\ndevice: cuda:0\nepochs: 50\nbatch_size: 64\nlearning_rate: 0.001\n\ndataset: ./datasets/imagenet\noutput: ./runs",
    "results.csv": "epoch,loss,accuracy\n21,0.184,94.2\n22,0.169,94.7\n23,0.152,95.1\n24,0.141,95.4",
    "README.md":
        "# Vision Lab\n\nTraining experiments on atlas.\n\n## Run\npython train.py\n\n## Monitor\ntensorboard --logdir runs",
};
const FilesMarkup = `<div class="terminal"><div class="pane-title"><span data-file-title>train.py</span><span>Preview</span></div><pre class="code-content" data-file-content></pre></div><div class="side-panel"><div class="pane-title"><span>Files / vision-lab</span><span>atlas</span></div><div class="file-list">${Object.keys(
    FileContents
)
    .map(
        (name) =>
            `<button data-file="${name}" aria-pressed="${name === "train.py"}"><span><i aria-hidden="true">↳</i>${name}</span><small>${name.endsWith(".py") ? "Python" : name.split(".").at(-1)}</small></button>`
    )
    .join("")}</div><p class="file-note">/home/demo/vision-lab</p></div>`;

const AiMarkup =
    terminal(
        "npm run build",
        '<span class="terminal-red">error TS2688:\nCannot find type definition file for node.</span>\n\n<span class="terminal-dim">~/vision-lab $</span> <span data-ai-prompt></span>',
        '<span class="terminal-red">EXIT 2</span>'
    ) +
    `<div class="side-panel"><div class="pane-title"><span>✳ Fix / npm run build</span><span>Claude Code</span></div><div class="ai-body"><p>The build needs Node.js type definitions.</p><div class="ai-proposal"><code>npm install --save-dev @types/node</code><p>Install the missing development dependency.</p><div class="ai-actions"><button data-insert>Insert ↵</button><span>Review, then run.</span></div></div><div class="ai-foot" data-ai-status role="status">Include output · 42 lines</div></div></div>`;

function selectView(button) {
    const view = button.dataset.view;
    for (const tab of $$("[role=tab]")) {
        tab.setAttribute("aria-selected", String(tab === button));
        tab.tabIndex = tab === button ? 0 : -1;
    }
    $("#demo-panel").setAttribute("aria-labelledby", button.id);
    Demo.innerHTML = { sessions: SessionMarkup, host: HostMarkup, files: FilesMarkup, ai: AiMarkup }[view];
    Demo.dataset.view = view;
    Demo.classList.remove("is-disconnected");
    $("[data-caption]").textContent = Captions[view];
    $("[data-caption-index]").textContent = `0${Object.keys(Captions).indexOf(view) + 1} / 04`;
    $("[data-bottom-status]").textContent = "Connected to atlas";
    if (view === "files") $("[data-file-content]").textContent = FileContents["train.py"];
}

for (const button of $$("[role=tab]")) button.addEventListener("click", () => selectView(button));
$(".demo-tabs").addEventListener("keydown", (event) => {
    const tabs = $$("[role=tab]");
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    let index;
    if (event.key === "ArrowRight") index = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") index = (current + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[index].focus();
    selectView(tabs[index]);
});

Demo.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-session")) {
        const disconnected = Demo.classList.toggle("is-disconnected");
        $("[data-session-label]").textContent = disconnected ? "Disconnected" : "Reattached";
        $("[data-session-message]").textContent = disconnected
            ? "Laptop disconnected. The same process is still running."
            : "Same session. The output you missed is restored.";
        button.textContent = disconnected ? "Reconnect laptop ↗" : "Disconnect laptop ↗";
        $("[data-bottom-status]").textContent = disconnected
            ? "Offline · process running on atlas"
            : "Reattached · pid 2841";
        $(".connection-line span").textContent = disconnected ? "OFFLINE" : "SSH";
        if (!disconnected)
            $(".terminal-output").textContent =
                "epoch  23/50   loss 0.152   acc 95.1%\nepoch  24/50   loss 0.141   acc 95.4%\nepoch  25/50   loss 0.136   acc 95.7%\ncheckpoint saved → runs/latest.pt\n\n[buffered output restored]\nepoch  26/50   training…";
    }
    if (button.hasAttribute("data-forward")) {
        const active = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(active));
        button.textContent = active ? "Stop forward ×" : "Forward port ↗";
        $("[data-port-result]").textContent = active ? "Demo: atlas:6006 → localhost:6006" : "";
    }
    if (button.dataset.file) {
        for (const file of $$("[data-file]")) file.setAttribute("aria-pressed", String(file === button));
        $("[data-file-title]").textContent = button.dataset.file;
        $("[data-file-content]").textContent = FileContents[button.dataset.file];
    }
    if (button.hasAttribute("data-insert")) {
        $("[data-ai-prompt]").textContent = "npm install --save-dev @types/node";
        $("[data-ai-status]").textContent = "Inserted at the prompt. Ready for your review.";
        button.textContent = "Inserted ✓";
    }
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

const Film = $(".film-dialog");
const Video = Film.querySelector("video");
$("[data-play-film]").addEventListener("click", (event) => {
    if (typeof Film.showModal !== "function") return;
    event.preventDefault();
    Film.showModal();
    Video.play().catch(() => {});
});
$("[data-close-film]").addEventListener("click", () => Film.close());
Film.addEventListener("close", () => Video.pause());
Film.addEventListener("click", (event) => {
    if (event.target !== Film) return;
    const rect = Film.getBoundingClientRect();
    if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
    )
        Film.close();
});
