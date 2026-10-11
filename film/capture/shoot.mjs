// The whole shoot in one CDP session: the 4x density override lives only as long as the
// session that set it. usage: node capture/shoot.mjs [scene ...]
import { execSync } from "node:child_process";
import { connect } from "./driver.mjs";

const OUT = new URL("../public/captures", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CD = { "cmd:initscript.bash": "cd ~/llm" };
const LOCAL = {
    "cmd:env": { BASH_SILENCE_DEPRECATION_WARNING: "1" },
    "cmd:initscript.bash": "PS1='\\[\\e[38;5;75m\\]\\w\\[\\e[0m\\] \\$ '",
};

const d = await connect();
await d.setDensity();
await d.stage();
console.log("density", await d.eval("devicePixelRatio"));

const promptReady = (text) =>
    d.waitFor(`window.term && window.term.terminal.buffer.active.getLine(0)?.translateToString(true).includes(${JSON.stringify(text)})`, 30000);

async function fresh(connection, extra, keepOthers = false) {
    const id = await d.createTerm(connection, { extra });
    if (!keepOthers) {
        await d.closeAllBut([id]);
    }
    return id;
}

const lastEpoch = () =>
    d.eval(`(() => { const b = window.term.terminal.buffer.active; let m = 0;
        for (let i = 0; i < b.length; i++) { const s = b.getLine(i)?.translateToString(true) ?? "";
          const r = s.match(/epoch\\s+(\\d+)\\//); if (r) m = Math.max(m, +r[1]); } return m; })()`);

// after a command ends, the shell opens an empty block for the next prompt; skip it
const lastBlockState = () =>
    d.eval(`(() => { const bs = globalStore.get(window.term.cmdBlocksAtom).filter(b => b.command); const b = bs[bs.length - 1]; return b ? { state: b.state, exit: b.exitCode, cmd: b.command } : null; })()`);

const box = (cmd) =>
    execSync(`ssh paw-5090-ws-tailscale ${JSON.stringify(`docker exec -u ml genie-gpu-box bash -lc ${JSON.stringify(cmd)}`)}`, { stdio: "pipe" }).toString();

// the GPU load for the Host and TensorBoard shots runs as a background job on the box;
// patterns are anchored so pkill can't match the shell that runs it
function backgroundTraining() {
    box("pkill -f '^/usr/local/bin/python3.11 /usr/local/bin/tensorboard'; pkill -f '^python train.py'; sleep 1; cd ~/llm && rm -rf runs && (nohup python train.py > /tmp/train.log 2>&1 &)");
}

// buttons may carry a shortcut glyph after the label ("Insert ↵"), so match the start
const buttonCenter = (text, scope = "") =>
    d.eval(`(() => { const b = [...document.querySelectorAll("${scope} button")].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && !e.disabled);
        if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);

async function twoTerms() {
    const t1 = await fresh("gpu-box", CD);
    await promptReady("ml@gpu-box ~/llm");
    await d.runHidden(t1, "python train.py");
    await sleep(2000);
    const t2 = await d.createTerm("gpu-box", { extra: CD, targetblockid: t1, targetaction: "splitdown" });
    await promptReady("ml@gpu-box ~/llm");
    await sleep(600);
    await d.useTerm(t2);
    return { t1, t2 };
}

const scenes = {
    async s1_open() {
        const id = await fresh(null, LOCAL);
        await promptReady("~ $");
        await sleep(800);
        await d.useTerm(id);
        d.begin("s1_open", OUT);
        const geometry = await d.termGeometry();
        await d.snap("idle");
        await d.type("genie ssh gpu-box");
        await d.enter();
        d.mark("enter", d.scene.frames.length);
        await d.record(7000, 120, "connect");
        d.end({ geometry, after: await d.termGeometry() });
    },

    async s2_train() {
        const id = await fresh("gpu-box", CD);
        await promptReady("ml@gpu-box ~/llm");
        await sleep(800);
        await d.useTerm(id);
        d.begin("s2_train", OUT);
        const geometry = await d.termGeometry();
        await d.snap("idle");
        await d.type("python train.py");
        await d.enter();
        d.mark("enter", d.scene.frames.length);
        const t0 = Date.now();
        while ((await lastEpoch()) < 12) {
            if (Date.now() - t0 > 90000) throw new Error("training never reached epoch 12");
            await d.snap("train");
        }
        await d.snap("epoch12");
        d.mark("epoch12");
        d.end({ geometry, block: id });

        d.begin("s3_lid", OUT);
        await d.snap("before");
        await d.eval(`RpcApi.ConnDisconnectCommand(TabRpcClient, "gpu-box")`);
        d.mark("disconnect", d.scene.frames.length);
        await d.record(2500, 150, "down");
        await sleep(20000);
        await d.snap("still-down");
        const rc = await buttonCenter("Reconnect");
        await d.move(rc.x - 300, rc.y + 220);
        await d.snap("cursor");
        await d.click(rc.x, rc.y);
        d.mark("reconnect", d.scene.frames.length);
        await d.record(8000, 90, "catchup");
        d.end({ geometry: await d.termGeometry(), block: id, reconnectButton: rc, epochAfter: await lastEpoch() });
    },

    async s4_host() {
        backgroundTraining();
        const t2 = await fresh("gpu-box", CD);
        await promptReady("ml@gpu-box ~/llm");
        await sleep(15000);
        await d.useTerm(t2);
        d.begin("s4_host", OUT);
        const geometry = await d.termGeometry();
        await d.snap("idle");
        await d.type("nvidia-smi");
        await d.enter();
        d.mark("enter", d.scene.frames.length);
        await d.record(2500, 150, "smi");
        const rail = await d.eval(`(() => { const el = [...document.querySelectorAll("div")].find(e => e.children.length <= 2 && e.textContent.trim() === "host" && e.getBoundingClientRect().x > 1500);
            const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 - 8 }; })()`);
        await d.move(rail.x - 260, rail.y + 300);
        await d.snap("cursor");
        await d.click(rail.x, rail.y);
        d.mark("hostClick", d.scene.frames.length);
        await d.record(8000, 200, "host");
        const rects = await d.rects({ gpu: '[aria-label^="Show GPU 0"]', hostTabs: '[aria-label="Host sections"]' });
        d.end({ geometry, rail, rects, t2 });
    },

    async s5_ports() {
        // a forward left by an earlier take would turn the offer into a plain "Open"
        await d.eval(`(async () => { for (const f of (await RpcApi.PortForwardListCommand(TabRpcClient, {})) ?? []) {
            await RpcApi.PortForwardStopCommand(TabRpcClient, { id: f.id }); } })()`);
        backgroundTraining();
        const t2 = await fresh("gpu-box", CD);
        await promptReady("ml@gpu-box ~/llm");
        await sleep(25000);
        await d.useTerm(t2);
        d.begin("s5_ports", OUT);
        const geometry = await d.termGeometry();
        await d.snap("idle");
        await d.type("tensorboard --logdir runs");
        await d.enter();
        d.mark("enter", d.scene.frames.length);
        const t0 = Date.now();
        while (!(await d.eval("!!document.querySelector('.term-forward-dock')"))) {
            await d.snap("starting");
            if (Date.now() - t0 > 30000) throw new Error("no forward offer");
        }
        d.mark("offer", d.scene.frames.length);
        await d.record(1500, 120, "offer");
        const dock = (await d.rects({ dock: ".term-forward-dock [role=status]" })).dock;
        const btn = await buttonCenter("Open in Browser", ".term-forward-dock");
        await d.move(btn.x - 260, btn.y - 180);
        await d.snap("cursor");
        const before = await d.blockIds();
        await d.click(btn.x, btn.y);
        d.mark("click", d.scene.frames.length);
        await d.record(4500, 200, "open");
        // scroll TensorBoard down to its loss chart, the way you would with a trackpad
        const web = (await d.blockIds()).find((b) => !before.includes(b));
        const wr = (await d.rects({ web: `[data-blockid="${web}"]` })).web;
        d.mark("scroll", d.scene.frames.length);
        for (let i = 0; i < 8; i++) {
            await d.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: wr.x + wr.w * 0.6, y: wr.y + wr.h * 0.6, deltaX: 0, deltaY: 60 });
            await d.snap("scroll");
        }
        await d.record(6000, 220, "chart");
        d.end({ geometry, dock, btn, t2, web: wr });
    },

    async s6_files() {
        const id = await fresh("gpu-box", CD);
        await promptReady("ml@gpu-box ~/llm");
        await sleep(800);
        await d.useTerm(id);
        d.begin("s6_files", OUT);
        const geometry = await d.termGeometry();
        await d.snap("idle");
        await d.type("genie view .");
        await d.enter();
        d.mark("enter", d.scene.frames.length);
        await d.record(3500, 160, "files");
        const row = await d.eval(`(() => { const el = [...document.querySelectorAll("div, td, span")].filter(e => e.textContent.trim() === "train.py").pop(); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await d.move(row.x + 160, row.y + 140);
        await d.snap("cursor");
        await d.dblclick(row.x, row.y);
        d.mark("open", d.scene.frames.length);
        await d.record(4000, 160, "preview");
        d.end({ geometry, block: id, row });
    },

    async s7_fix() {
        box("pkill -f '^/usr/local/bin/python3.11 /usr/local/bin/tensorboard'; pkill -f '^python train.py'; pip uninstall -y -q flash-attn; pip cache purge; true");
        const id = await fresh("gpu-box", CD);
        await promptReady("ml@gpu-box ~/llm");
        await sleep(800);
        await d.useTerm(id);
        d.begin("s7_fix", OUT);
        const geometry = await d.termGeometry();
        await d.snap("idle");
        await d.type("pip install flash-attn");
        await d.enter();
        d.mark("enter", d.scene.frames.length);
        let t0 = Date.now();
        for (;;) {
            await d.snap("pip");
            const st = await lastBlockState();
            if (st?.state === "done") break;
            if (Date.now() - t0 > 120000) throw new Error("pip never finished");
        }
        d.mark("failed");
        await d.record(1200, 150, "failed");
        const fix = (await d.rects({ fix: '[aria-label="Fix with AI"]' })).fix;
        await d.move(fix.x + fix.w / 2 - 240, fix.y + 200);
        await d.snap("cursor");
        await d.click(fix.x + fix.w / 2, fix.y + fix.h / 2);
        d.mark("askAi", d.scene.frames.length);
        t0 = Date.now();
        while (!(await buttonCenter("Insert"))) {
            await d.snap("ai");
            if (Date.now() - t0 > 90000) throw new Error("no AI answer");
        }
        d.mark("aiReady", d.scene.frames.length);
        const first = await d.eval(`(() => { const b = [...document.querySelectorAll("button")].find(e => e.textContent.trim().startsWith("Insert") && !e.disabled);
            let el = b; while (el && !el.querySelector("code, .font-mono")) el = el.parentElement; return el ? el.textContent : ""; })()`);
        console.log("first suggestion:", first.slice(0, 200));
        // the model's answer varies run to run; keep the take whose first answer is the fix
        if (!first.includes("FLASH_ATTENTION_SKIP_CUDA_BUILD")) {
            await d.key("Escape", "Escape", 27);
            throw new Error("retake");
        }
        await d.record(2000, 150, "aiReady");
        const ins = await buttonCenter("Insert");
        const suggestion = first;
        await d.move(ins.x - 200, ins.y - 120);
        await d.snap("cursorInsert");
        await d.click(ins.x, ins.y);
        d.mark("insert", d.scene.frames.length);
        await d.record(1200, 150, "inserted");
        await d.useTerm(id);
        await d.enter();
        d.mark("run", d.scene.frames.length);
        t0 = Date.now();
        for (;;) {
            await d.snap("fixing");
            const st = await lastBlockState();
            if (st?.state === "done" && Date.now() - t0 > 1500) {
                console.log("fix result", JSON.stringify(st));
                break;
            }
            if (Date.now() - t0 > 300000) throw new Error("fix never finished");
        }
        d.mark("fixed", d.scene.frames.length - 1);
        await d.record(2000, 150, "done");
        d.end({ geometry, block: id, suggestion, fix, ins, result: await lastBlockState() });
        console.log("suggestion", suggestion);
    },

    async s8_exit() {
        const id = await fresh("gpu-box", CD);
        await promptReady("ml@gpu-box ~/llm");
        await sleep(800);
        await d.useTerm(id);
        d.begin("s8_exit", OUT);
        const geometry = await d.termGeometry();
        await d.snap("idle");
        await d.type("exit");
        await d.enter();
        d.mark("enter", d.scene.frames.length);
        await d.record(1200, 150, "exit");
        d.end({ geometry, block: id });
    },
};

const wanted = process.argv.slice(2);
for (const name of wanted.length ? wanted : Object.keys(scenes)) {
    for (let take = 1; ; take++) {
        console.log("shooting", name, "take", take);
        try {
            await scenes[name]();
            break;
        } catch (e) {
            if (e.message !== "retake" || take >= 4) throw e;
            console.log("retake", name);
        }
    }
    console.log("done", name);
}
d.close();
process.exit(0);
