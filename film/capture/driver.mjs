// Drives the GenieTerm dev app over CDP and captures real frames at 4x density.
// Every frame on screen in the film comes from here: real UI, real commands, real output.
import fs from "node:fs";
import path from "node:path";

export const VIEW_W = 1600;
export const VIEW_H = 900;
export const DSF = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(port = 9333) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const target = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && waiting.has(msg.id)) {
            waiting.get(msg.id)(msg);
            waiting.delete(msg.id);
        }
    };
    const send = (method, params = {}) =>
        new Promise((resolve) => {
            const n = ++id;
            waiting.set(n, resolve);
            ws.send(JSON.stringify({ id: n, method, params }));
        });
    return new Driver(send, () => ws.close());
}

export class Driver {
    constructor(send, close) {
        this.send = send;
        this.close = close;
        this.scene = null;
        this.frames = [];
        this.t0 = Date.now();
    }

    async eval(expr) {
        const res = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
        if (res.result?.exceptionDetails) {
            throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 600));
        }
        return res.result?.result?.value;
    }

    // Density has to be in place before the terminals are created, or xterm keeps the cell
    // size it measured at the old ratio and draws text at the wrong scale.
    async setDensity() {
        await this.send("Emulation.setDeviceMetricsOverride", {
            width: VIEW_W,
            height: VIEW_H,
            deviceScaleFactor: DSF,
            mobile: false,
        });
        await this.eval("location.reload()").catch(() => {});
        await sleep(6000);
        await this.waitFor("window.term != null && document.querySelector('.xterm-screen') != null", 30000);
    }

    async waitFor(expr, timeout = 15000, every = 100) {
        const until = Date.now() + timeout;
        while (Date.now() < until) {
            if (await this.eval(`!!(${expr})`).catch(() => false)) {
                return true;
            }
            await sleep(every);
        }
        throw new Error(`timed out waiting for ${expr}`);
    }

    async painted() {
        await this.eval("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
    }

    // Staging is done between takes and never captured.
    async stage() {
        await this.eval(`(() => {
            if (document.getElementById("film-stage")) return;
            const st = document.createElement("style");
            st.id = "film-stage";
            st.textContent = '[title="Running GenieTerm Dev Build"]{display:none !important}';
            document.head.appendChild(st);
        })()`);
    }

    async tabId() {
        return this.eval("globalStore.get(globalAtoms.staticTabId)");
    }

    async blockIds() {
        return this.eval(`WOS.getObjectValue("tab:" + globalStore.get(globalAtoms.staticTabId))?.blockids ?? []`);
    }

    async blockMeta(id) {
        return this.eval(`WOS.getObjectValue("block:${id}")?.meta`);
    }

    async closeAllBut(keep = []) {
        for (const id of await this.blockIds()) {
            if (!keep.includes(id)) {
                await this.eval(`RpcApi.DeleteBlockCommand(TabRpcClient, { blockid: "${id}" })`);
            }
        }
        await sleep(600);
    }

    async createTerm(connection, { targetblockid, targetaction, cwd, extra } = {}) {
        const meta = { view: "term", controller: "shell", ...(extra ?? {}) };
        if (connection) meta.connection = connection;
        if (cwd) meta["cmd:cwd"] = cwd;
        const data = { tabid: await this.tabId(), blockdef: { meta }, focused: true };
        if (targetblockid) {
            data.targetblockid = targetblockid;
            data.targetaction = targetaction ?? "splitright";
        }
        const oref = await this.eval(`RpcApi.CreateBlockCommand(TabRpcClient, ${JSON.stringify(data)})`);
        await sleep(2500);
        return oref.split(":")[1];
    }

    async createBlock(meta, opts = {}) {
        const data = { tabid: await this.tabId(), blockdef: { meta }, ...opts };
        const oref = await this.eval(`RpcApi.CreateBlockCommand(TabRpcClient, ${JSON.stringify(data)})`);
        await sleep(1500);
        return oref.split(":")[1];
    }

    // window.term is the last terminal created; aim it at a specific block for typing
    async useTerm(blockId) {
        await this.eval(`(() => {
            const el = document.querySelector('[data-blockid="${blockId}"] .xterm');
            if (!el) throw new Error("no xterm for ${blockId}");
            el.querySelector("textarea").focus();
        })()`);
        this.termBlock = blockId;
    }

    async runHidden(blockId, text) {
        const b64 = Buffer.from(text + "\r").toString("base64");
        await this.eval(`RpcApi.ControllerInputCommand(TabRpcClient, { blockid: "${blockId}", inputdata64: "${b64}" })`);
    }

    async clearTerm() {
        await this.eval("window.term.terminal.clear()");
    }

    begin(scene, dir) {
        this.scene = { name: scene, dir: path.join(dir, scene), frames: [], marks: {} };
        fs.mkdirSync(this.scene.dir, { recursive: true });
        this.sceneT0 = Date.now();
    }

    async snap(label = "") {
        await this.stage();
        await this.painted();
        const t = Date.now() - this.sceneT0;
        const res = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true });
        const idx = this.scene.frames.length;
        const file = `${String(idx).padStart(4, "0")}.png`;
        fs.writeFileSync(path.join(this.scene.dir, file), Buffer.from(res.result.data, "base64"));
        this.scene.frames.push({ t, file, label });
        return idx;
    }

    mark(name, value) {
        this.scene.marks[name] = value ?? this.scene.frames.length - 1;
    }

    async rects(selectors) {
        const js = `(() => {
            const out = {};
            const sels = ${JSON.stringify(selectors)};
            for (const [name, sel] of Object.entries(sels)) {
                const el = typeof sel === "string" ? document.querySelector(sel) : null;
                if (!el) continue;
                const r = el.getBoundingClientRect();
                out[name] = { x: r.x, y: r.y, w: r.width, h: r.height };
            }
            return out;
        })()`;
        return this.eval(js);
    }

    // xterm cell geometry and caret position, so the film can draw vector type over the capture
    async termGeometry() {
        return this.eval(`(() => {
            const t = window.term.terminal;
            const core = t._core;
            const cell = core._renderService.dimensions.css.cell;
            const screen = t.element.querySelector('.xterm-screen').getBoundingClientRect();
            const buf = t.buffer.active;
            return { cellW: cell.width, cellH: cell.height, x: screen.x, y: screen.y,
                     cursorX: buf.cursorX, cursorY: buf.cursorY, cols: t.cols, rows: t.rows,
                     fontSize: t.options.fontSize };
        })()`);
    }

    async termLine(row) {
        return this.eval(`window.term.terminal.buffer.active.getLine(window.term.terminal.buffer.active.viewportY + ${row})?.translateToString(true)`);
    }

    end(extra = {}) {
        const meta = { name: this.scene.name, frames: this.scene.frames, marks: this.scene.marks, ...extra };
        fs.writeFileSync(path.join(this.scene.dir, "scene.json"), JSON.stringify(meta, null, 1));
        const out = this.scene;
        this.scene = null;
        return out;
    }

    // One capture per keystroke: Remotion decides when each one is shown.
    async type(text, { snapEach = true } = {}) {
        for (const ch of text) {
            await this.send("Input.insertText", { text: ch });
            await this.waitTermSettled();
            if (snapEach) {
                await this.snap(`key:${ch}`);
            }
        }
    }

    async enter() {
        await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }

    async key(key, code, vk, modifiers = 0, text) {
        await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers, text });
        await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    }

    async waitTermSettled(quietMs = 60, timeout = 3000) {
        let last = "";
        let stableSince = Date.now();
        const until = Date.now() + timeout;
        while (Date.now() < until) {
            const now = await this.eval(
                "(() => { const b = window.term.terminal.buffer.active; let s = b.cursorX + ':' + b.cursorY + ':' + b.baseY; const l = b.getLine(b.baseY + b.cursorY); return s + (l ? l.translateToString(true) : ''); })()"
            );
            if (now !== last) {
                last = now;
                stableSince = Date.now();
            } else if (Date.now() - stableSince >= quietMs) {
                return;
            }
            await sleep(15);
        }
    }

    async move(x, y) {
        await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    }

    async click(x, y) {
        await this.move(x, y);
        await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    }

    async dblclick(x, y) {
        await this.move(x, y);
        for (const clickCount of [1, 2]) {
            await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount });
            await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount });
        }
    }

    async clickSelector(sel) {
        const r = (await this.rects({ target: sel })).target;
        if (!r) {
            throw new Error(`no element for ${sel}`);
        }
        const x = r.x + r.w / 2;
        const y = r.y + r.h / 2;
        await this.click(x, y);
        return { x, y };
    }

    // Captures at a steady interval while something streams (logs, live gauges).
    async record(ms, every = 120, label = "rec") {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            const t = Date.now();
            await this.snap(label);
            const spent = Date.now() - t;
            if (spent < every) {
                await sleep(every - spent);
            }
        }
    }
}
