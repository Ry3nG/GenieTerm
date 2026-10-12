// GenieTerm project page: reveals, the focused block, films, downloads.
// Everything here is progressive: without it the page still reads and every link works.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- reveal on scroll, staggered within each section ----------

const revealObserver = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.setAttribute("data-shown", "");
            revealObserver.unobserve(entry.target);
        }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.1 }
);

for (const section of document.querySelectorAll("section")) {
    section.querySelectorAll(".reveal").forEach((el, i) => {
        el.style.setProperty("--delay", `${Math.min(i, 6) * 70}ms`);
        revealObserver.observe(el);
    });
}

// ---------- the focused block: whichever block crosses the middle of the screen ----------

const blocks = [...document.querySelectorAll("[data-block]")];
const tabs = [...document.querySelectorAll("[data-tab]")];
let focused = null;

function focus(block) {
    if (block === focused) return;
    focused?.removeAttribute("data-focused");
    focused = block;
    block?.setAttribute("data-focused", "");
    const section = block?.closest("[data-section]")?.getAttribute("data-section");
    for (const t of tabs) {
        t.setAttribute("aria-current", String(t.getAttribute("data-tab") === section));
    }
}

const focusObserver = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) focus(entry.target);
            else if (entry.target === focused) focus(null);
        }
    },
    { rootMargin: "-48% 0px -48% 0px" }
);
blocks.forEach((b) => focusObserver.observe(b));

// ---------- the film: plays with sound on request ----------

const film = document.querySelector(".film");
const filmVideo = film?.querySelector("video");
film?.querySelector(".film-play").addEventListener("click", () => {
    pauseClips();
    filmVideo.controls = true;
    film.setAttribute("data-playing", "");
    filmVideo.play();
});
filmVideo?.addEventListener("ended", () => {
    filmVideo.controls = false;
    filmVideo.currentTime = 0;
    film.removeAttribute("data-playing");
});
filmVideo?.addEventListener("play", () => pauseClips());

// ---------- feature films: muted while in view, sound on request ----------

const clips = [...document.querySelectorAll("[data-clip]")].map((el) => ({ el, video: el.querySelector("video"), sound: el.querySelector("[data-sound]") }));

function pauseClips() {
    for (const c of clips) c.video.pause();
}

function setSound(clip, on) {
    clip.video.muted = !on;
    clip.sound.setAttribute("aria-pressed", String(on));
    clip.sound.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on");
}

const clipObserver = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            const clip = clips.find((c) => c.el === entry.target);
            if (entry.isIntersecting) {
                if (!reduceMotion && (!filmVideo || filmVideo.paused)) clip.video.play().catch(() => {});
            } else {
                clip.video.pause();
                setSound(clip, false);
            }
        }
    },
    { threshold: 0.4 }
);

for (const clip of clips) {
    clipObserver.observe(clip.el);
    clip.sound.addEventListener("click", () => {
        const on = clip.video.muted;
        if (on) {
            // sound means attention: start from the top and quiet everything else
            for (const other of clips) if (other !== clip) setSound(other, false);
            filmVideo?.pause();
            clip.video.currentTime = 0;
        }
        setSound(clip, on);
        clip.video.play().catch(() => {});
    });
    if (reduceMotion) {
        clip.video.addEventListener("click", () => (clip.video.paused ? clip.video.play() : clip.video.pause()));
    }
}

// ---------- downloads: tabs, the visitor's platform first ----------

const osTabs = [...document.querySelectorAll("[data-os]")];
function selectOS(os) {
    for (const t of osTabs) {
        const on = t.getAttribute("data-os") === os;
        t.setAttribute("aria-selected", String(on));
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
}
for (const t of osTabs) {
    t.addEventListener("click", () => selectOS(t.getAttribute("data-os")));
    t.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const i = osTabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : -1);
        const next = osTabs[(i + osTabs.length) % osTabs.length];
        selectOS(next.getAttribute("data-os"));
        next.focus();
    });
}

function detectOS() {
    const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
    if (p.includes("mac")) return "mac";
    if (p.includes("win")) return "windows";
    if (p.includes("linux") || p.includes("x11")) return "linux";
    return null;
}
const os = detectOS();
if (os) {
    selectOS(os);
    const cta = document.querySelector("[data-download-cta]");
    if (cta && os !== "windows") cta.textContent = os === "mac" ? "Download for macOS" : "Download for Linux";
}

for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", async () => {
        const text = btn.parentElement.querySelector("[data-snippet]").textContent;
        try {
            await navigator.clipboard.writeText(text);
            btn.textContent = "Copied";
            setTimeout(() => (btn.textContent = "Copy"), 1600);
        } catch {
            // clipboard unavailable: the command stays selectable
        }
    });
}

// ---------- the latest release: version, notes link, exact asset links ----------

async function loadRelease() {
    try {
        const res = await fetch("https://api.github.com/repos/Ry3nG/GenieTerm/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) return;
        const rel = await res.json();
        const version = rel.tag_name.replace(/^v/, "");
        const date = new Date(rel.published_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

        const v = document.querySelector("[data-version]");
        v.textContent = `v${version}`;
        v.href = rel.html_url;
        v.hidden = false;

        // the first sentence of the notes is the release's own one-line summary
        const summary = (rel.body || "").split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--"));
        const chip = document.querySelector("[data-release-chip]");
        chip.innerHTML = "";
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = `New in ${version.split(".").slice(0, 2).join(".")}`;
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = `${summary ? summary.split(". ")[0].replace(/\.$/, "") : "Release notes"} →`;
        chip.append(tag, text);
        chip.href = rel.html_url;
        chip.hidden = false;

        document.querySelector("[data-release-line]").textContent = `Version ${version}, released ${date}. Free, for macOS and Linux, with a Windows preview.`;
        for (const a of document.querySelectorAll("[data-asset]")) {
            const asset = rel.assets.find((x) => new RegExp(a.getAttribute("data-asset"), "i").test(x.name));
            if (asset) a.href = asset.browser_download_url;
        }
        const snippet = document.querySelector("[data-snippet]");
        if (snippet) snippet.textContent = `sudo apt install ./GenieTerm-linux-x64-${version}.deb`;
    } catch {
        // offline or rate-limited: everything keeps pointing at the releases page
    }
}
loadRelease();

// ---------- the hero's live session: an agent at work on the server, on a quiet loop ----------

const live = document.querySelector("[data-live]");
if (live) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const L = (html) => html;
    const script = [
        { t: 0, html: L(`<span class="u">ml@atlas</span> <span class="p">~/llm</span> $ claude`) },
        { t: 500, html: L(`<span class="d">&gt;</span> <span class="w">${esc("Switch train.py to bf16 autocast and get the tests passing")}</span>`) },
        { t: 1500, html: L(`<span class="a">●</span> Read(<span class="w">train.py</span>)`) },
        { t: 2400, html: L(`<span class="a">●</span> Update(<span class="w">train.py</span>)`) },
        { t: 2700, html: L(`  <span class="d">⎿  Wrapped the forward pass in torch.autocast</span>`) },
        { t: 3800, html: L(`<span class="a">●</span> Bash(<span class="w">pytest -q</span>)`) },
        { t: 5600, html: L(`  <span class="d">⎿  </span><span class="r">3 failed</span><span class="d">, 39 passed</span>`) },
        { t: 6600, html: L(`<span class="a">●</span> Update(<span class="w">tests/test_loss.py</span>)`) },
        { t: 7600, html: L(`<span class="a">●</span> Bash(<span class="w">pytest -q</span>)`) },
        { t: 9200, html: L(`  <span class="d">⎿  </span><span class="g">42 passed</span><span class="d"> in 18.4s</span>`) },
        { t: 10000, html: L(`<span class="g">✓</span> <span class="w">Done.</span> All 42 tests pass.`) },
    ];
    const LOOP = 14500;
    const status = document.querySelector("[data-live-status]");
    const spin = document.querySelector("[data-live-spin]");
    let start = performance.now();
    let shown = -1;
    let minutes = 12;
    const render = (n, done) => {
        live.innerHTML = script
            .slice(0, n + 1)
            .map((s) => s.html)
            .join("\n") + (done ? "" : ` <span class="cur"></span>`);
    };
    if (reduceMotion) {
        render(script.length - 1, true);
    } else {
        const tick = (now) => {
            const t = (now - start) % LOOP;
            if (now - start >= LOOP) {
                start = now - t;
                minutes += 9;
            }
            let n = script.findLastIndex((s) => s.t <= t);
            if (n !== shown) {
                shown = n;
                const done = n === script.length - 1;
                render(n, done);
                status.textContent = done ? `Finished ${minutes + 9}m` : `Running ${minutes}m`;
                spin.className = done ? "dot ok" : "spin";
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }
}
