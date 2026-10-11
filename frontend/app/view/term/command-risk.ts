// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

// Classifies a proposed shell command before the person runs it. The command is
// canonicalized first (quotes and escapes removed, wrappers such as sudo, env and xargs
// unwrapped, nested `sh -c`, `$(...)` and `find -exec` commands parsed) so that spelling
// tricks like `\rm`, `r''m` or `/bin/rm` are classified like `rm`.

export type CommandRiskLevel = "safe" | "caution" | "danger";

export type CommandRisk = {
    level: CommandRiskLevel;
    reasons: string[];
};

type Finding = { level: Exclude<CommandRiskLevel, "safe">; reason: string };

type Redirect = { op: string; target: string };

type Segment = {
    words: string[];
    redirects: Redirect[];
    pipedFrom?: Segment;
};

type ParseResult = {
    segments: Segment[];
    nested: string[];
};

const MaxNestingDepth = 4;

const Reason = {
    Admin: "Runs as administrator",
    DeletesFiles: "Deletes files",
    ErasesDisk: "Erases a disk",
    DiscardsChanges: "Discards uncommitted changes",
    ForcePush: "Overwrites remote history",
    DeletesBranch: "Deletes a branch",
    KillsProcesses: "Force-stops processes",
    StopsProcess: "Stops a process",
    Shutdown: "Shuts down or restarts the machine",
    RecursivePermissions: "Changes permissions recursively",
    WorldWritable: "Makes files writable by everyone",
    RemoteCode: "Runs code from the internet",
    DeletesData: "Deletes database data",
    DeletesResources: "Deletes cloud or container resources",
    ForkBomb: "Can freeze the machine",
    SystemFile: "Overwrites a system file",
    Firewall: "Turns off the firewall",
    Crontab: "Deletes all scheduled jobs",
    WritesFiles: "Writes files",
    OverwritesFile: "Overwrites a file",
    Network: "Uses the network",
    Installs: "Installs or removes software",
    RunsPackage: "Downloads and runs a package",
    Publishes: "Publishes to the internet",
    ChangesRepo: "Changes the repository",
    RewritesHistory: "Rewrites git history",
    Permissions: "Changes permissions",
    Services: "Changes system services",
    Settings: "Changes system settings",
    Containers: "Changes containers",
    Cluster: "Changes cluster resources",
} as const;

const AdminPrograms = new Set(["sudo", "doas", "su", "pkexec", "run0"]);
const Interpreters = new Set([
    "sh",
    "bash",
    "zsh",
    "dash",
    "ksh",
    "fish",
    "python",
    "python3",
    "perl",
    "ruby",
    "node",
    "php",
    "pwsh",
    "powershell",
]);
const ShellPrograms = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const Downloaders = new Set(["curl", "wget", "fetch", "http", "https", "iwr", "irm", "invoke-webrequest"]);
const NetworkPrograms = new Set([
    "curl",
    "wget",
    "fetch",
    "http",
    "https",
    "ssh",
    "scp",
    "sftp",
    "ftp",
    "telnet",
    "nc",
    "ncat",
    "netcat",
    "socat",
    "mosh",
    "aria2c",
]);
const DiskPrograms = new Set(["dd", "fdisk", "sfdisk", "gdisk", "sgdisk", "parted", "wipefs", "shred", "format"]);
const DeletePrograms = new Set(["rm", "unlink", "srm", "shred"]);
const WritePrograms = new Set(["mkdir", "touch", "cp", "mv", "ln", "tee", "install", "patch", "truncate", "rmdir"]);
const PackageManagers: Record<string, Set<string>> = {
    brew: new Set(["install", "reinstall", "upgrade", "uninstall", "remove", "rm", "tap"]),
    apt: new Set(["install", "reinstall", "remove", "purge", "upgrade", "full-upgrade", "dist-upgrade", "autoremove"]),
    "apt-get": new Set(["install", "reinstall", "remove", "purge", "upgrade", "dist-upgrade", "autoremove"]),
    dnf: new Set(["install", "reinstall", "remove", "erase", "upgrade", "update", "autoremove"]),
    yum: new Set(["install", "reinstall", "remove", "erase", "upgrade", "update", "autoremove"]),
    zypper: new Set(["install", "in", "remove", "rm", "update", "up", "dist-upgrade", "dup"]),
    apk: new Set(["add", "del", "upgrade"]),
    port: new Set(["install", "uninstall", "upgrade"]),
    snap: new Set(["install", "remove", "refresh"]),
    flatpak: new Set(["install", "uninstall", "update"]),
    npm: new Set(["install", "i", "add", "ci", "uninstall", "remove", "rm", "update", "upgrade", "link"]),
    pnpm: new Set(["install", "i", "add", "remove", "rm", "update", "up", "upgrade", "link"]),
    yarn: new Set(["install", "add", "remove", "upgrade", "up", "link"]),
    bun: new Set(["install", "i", "add", "remove", "rm", "update", "link"]),
    pip: new Set(["install", "uninstall"]),
    pip3: new Set(["install", "uninstall"]),
    pipx: new Set(["install", "uninstall", "upgrade", "reinstall"]),
    uv: new Set(["add", "remove", "sync", "pip"]),
    conda: new Set(["install", "remove", "update", "create"]),
    mamba: new Set(["install", "remove", "update", "create"]),
    cargo: new Set(["install", "uninstall", "add", "remove"]),
    go: new Set(["install", "get"]),
    gem: new Set(["install", "uninstall", "update"]),
    composer: new Set(["install", "require", "remove", "update"]),
};
const PackageRunners = new Set(["npx", "bunx", "uvx", "pnpx"]);
const BlockDevicePattern = /^\/dev\/(sd|hd|vd|xvd|nvme|mmcblk|disk|rdisk|md|dm-|mapper\/)/;
const SystemPathPattern = /^\/(etc|boot|usr|bin|sbin|lib|lib64|System|Library|private\/etc)(\/|$)/;
const DownloadWordPattern = /\b(curl|wget|fetch|iwr|irm|invoke-webrequest)\b/i;
const ZeroWidthPattern = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

function normalizeCommandText(command: string): string {
    return (command ?? "").normalize("NFKC").replace(ZeroWidthPattern, "");
}

function isAssignment(word: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

function baseProgram(word: string): string {
    const slash = word.lastIndexOf("/");
    const base = slash >= 0 ? word.slice(slash + 1) : word;
    return base.toLowerCase().replace(/\.exe$/, "");
}

// Reads a $( ... ) or <( ... ) body starting just after the opening paren and returns
// the body and the index of the closing paren.
function readParenBody(text: string, start: number): { body: string; end: number } {
    let depth = 1;
    let quote = "";
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === "\\" && quote === '"') {
                i++;
            } else if (ch === quote) {
                quote = "";
            }
            continue;
        }
        if (ch === "\\") {
            i++;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }
        if (ch === "(") {
            depth++;
        } else if (ch === ")") {
            depth--;
            if (depth === 0) {
                return { body: text.slice(start, i), end: i };
            }
        }
    }
    return { body: text.slice(start), end: text.length };
}

function parseShell(text: string): ParseResult {
    const segments: Segment[] = [];
    const nested: string[] = [];
    let words: string[] = [];
    let redirects: Redirect[] = [];
    let word = "";
    let inWord = false;
    let quote = "";
    let pendingRedirect = "";
    let pipeNext = false;
    let lastSegment: Segment = null;

    const finishWord = () => {
        if (!inWord) {
            return;
        }
        if (pendingRedirect) {
            redirects.push({ op: pendingRedirect, target: word });
            pendingRedirect = "";
        } else {
            words.push(word);
        }
        word = "";
        inWord = false;
    };
    const finishSegment = (pipe: boolean) => {
        finishWord();
        if (pendingRedirect) {
            redirects.push({ op: pendingRedirect, target: "" });
            pendingRedirect = "";
        }
        if (words.length > 0 || redirects.length > 0) {
            const segment: Segment = { words, redirects };
            if (pipeNext && lastSegment != null) {
                segment.pipedFrom = lastSegment;
            }
            segments.push(segment);
            lastSegment = segment;
        }
        words = [];
        redirects = [];
        pipeNext = pipe;
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote === "'") {
            if (ch === "'") {
                quote = "";
            } else {
                word += ch;
            }
            continue;
        }
        if (quote === '"') {
            if (ch === '"') {
                quote = "";
            } else if (ch === "\\" && i + 1 < text.length && /["\\$`]/.test(text[i + 1])) {
                word += text[++i];
            } else if (ch === "$" && text[i + 1] === "(") {
                const { body, end } = readParenBody(text, i + 2);
                nested.push(body);
                word += "$(" + body + ")";
                i = end;
            } else if (ch === "`") {
                const end = text.indexOf("`", i + 1);
                const body = end < 0 ? text.slice(i + 1) : text.slice(i + 1, end);
                nested.push(body);
                word += "`" + body + "`";
                i = end < 0 ? text.length : end;
            } else {
                word += ch;
            }
            continue;
        }
        if (ch === "\\") {
            if (i + 1 < text.length) {
                if (text[i + 1] === "\n") {
                    i++;
                    continue;
                }
                word += text[++i];
                inWord = true;
            }
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            inWord = true;
            continue;
        }
        if (ch === "$" && text[i + 1] === "(") {
            const { body, end } = readParenBody(text, i + 2);
            nested.push(body);
            word += "$(" + body + ")";
            inWord = true;
            i = end;
            continue;
        }
        if ((ch === "<" || ch === ">") && text[i + 1] === "(") {
            const { body, end } = readParenBody(text, i + 2);
            nested.push(body);
            finishWord();
            words.push(`${ch}(${body})`);
            i = end;
            continue;
        }
        if (ch === "`") {
            const end = text.indexOf("`", i + 1);
            const body = end < 0 ? text.slice(i + 1) : text.slice(i + 1, end);
            nested.push(body);
            word += "`" + body + "`";
            inWord = true;
            i = end < 0 ? text.length : end;
            continue;
        }
        if (ch === "\n" || ch === ";") {
            finishSegment(false);
            continue;
        }
        if (ch === "&") {
            if (text[i + 1] === "&") {
                i++;
                finishSegment(false);
                continue;
            }
            if (text[i + 1] === ">") {
                finishWord();
                const op = text[i + 2] === ">" ? "&>>" : "&>";
                i += op.length - 1;
                pendingRedirect = op;
                continue;
            }
            if (word.endsWith(">") || pendingRedirect.endsWith(">")) {
                word += ch;
                inWord = true;
                continue;
            }
            finishSegment(false);
            continue;
        }
        if (ch === "|") {
            if (text[i + 1] === "|") {
                i++;
                finishSegment(false);
                continue;
            }
            if (text[i + 1] === "&") {
                i++;
            }
            finishSegment(true);
            continue;
        }
        if (ch === ">" || ch === "<") {
            let fd = "";
            if (inWord && /^\d+$/.test(word)) {
                fd = word;
                word = "";
                inWord = false;
            } else {
                finishWord();
            }
            let op = fd + ch;
            if (text[i + 1] === ch || (ch === ">" && text[i + 1] === "|")) {
                op += text[++i];
            }
            if (text[i + 1] === "&") {
                op += text[++i];
                let target = "";
                while (i + 1 < text.length && /[0-9-]/.test(text[i + 1])) {
                    target += text[++i];
                }
                redirects.push({ op, target });
                continue;
            }
            pendingRedirect = op;
            continue;
        }
        if (ch === " " || ch === "\t") {
            finishWord();
            continue;
        }
        if (ch === "(" || ch === ")" || ch === "{" || ch === "}") {
            if (!inWord) {
                finishSegment(false);
                continue;
            }
        }
        word += ch;
        inWord = true;
    }
    finishSegment(false);
    return { segments, nested };
}

type Unwrapped = { words: string[]; admin: boolean; viaXargs: boolean };

function skipOptions(words: string[], start: number, optsWithValue: Set<string>): number {
    let i = start;
    while (i < words.length && words[i].startsWith("-") && words[i] !== "-") {
        if (words[i] === "--") {
            return i + 1;
        }
        if (optsWithValue.has(words[i])) {
            i++;
        }
        i++;
    }
    return i;
}

function unwrapCommand(input: string[]): Unwrapped {
    let words = input;
    let admin = false;
    let viaXargs = false;
    for (let guard = 0; guard < 12 && words.length > 0; guard++) {
        let i = 0;
        while (i < words.length && isAssignment(words[i])) {
            i++;
        }
        words = words.slice(i);
        if (words.length === 0) {
            break;
        }
        const program = baseProgram(words[0]);
        if (program === "sudo" || program === "doas" || program === "run0") {
            admin = true;
            words = words.slice(skipOptions(words, 1, new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t"])));
            continue;
        }
        if (program === "env") {
            let j = skipOptions(words, 1, new Set(["-u", "-C", "-S"]));
            while (j < words.length && isAssignment(words[j])) {
                j++;
            }
            words = words.slice(j);
            continue;
        }
        if (program === "nice" || program === "ionice" || program === "stdbuf" || program === "caffeinate") {
            words = words.slice(skipOptions(words, 1, new Set(["-n", "-c", "-t", "-i", "-o", "-e", "-w"])));
            continue;
        }
        if (program === "timeout") {
            const j = skipOptions(words, 1, new Set(["-s", "-k", "--signal", "--kill-after"]));
            words = words.slice(j + 1);
            continue;
        }
        if (program === "watch") {
            words = words.slice(skipOptions(words, 1, new Set(["-n", "-d", "--interval"])));
            continue;
        }
        if (program === "xargs") {
            viaXargs = true;
            words = words.slice(
                skipOptions(words, 1, new Set(["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a", "--max-args"]))
            );
            continue;
        }
        if (["nohup", "time", "command", "builtin", "exec", "noglob", "then", "do", "else", "!"].includes(program)) {
            words = words.slice(1);
            continue;
        }
        break;
    }
    return { words, admin, viaXargs };
}

function hasFlag(args: string[], short: string[], long: string[] = []): boolean {
    for (const arg of args) {
        if (arg === "--") {
            return false;
        }
        if (long.includes(arg) || long.some((name) => arg.startsWith(name + "="))) {
            return true;
        }
        if (/^-[A-Za-z]+$/.test(arg) && short.some((flag) => arg.slice(1).includes(flag))) {
            return true;
        }
    }
    return false;
}

function positionalArgs(args: string[]): string[] {
    return args.filter((arg) => !arg.startsWith("-"));
}

function classifyGit(args: string[], findings: Finding[]) {
    let i = 0;
    while (i < args.length && args[i].startsWith("-")) {
        i += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[i]) ? 2 : 1;
    }
    const sub = args[i];
    const rest = args.slice(i + 1);
    switch (sub) {
        case "push":
            if (
                hasFlag(
                    rest,
                    ["f"],
                    ["--force", "--force-with-lease", "--force-if-includes", "--mirror", "--delete"]
                ) ||
                rest.some((arg) => arg.startsWith("+") || arg.startsWith(":"))
            ) {
                findings.push({ level: "danger", reason: Reason.ForcePush });
            } else {
                findings.push({ level: "caution", reason: Reason.Network });
            }
            return;
        case "reset":
            if (rest.includes("--hard") || rest.includes("--merge") || rest.includes("--keep")) {
                findings.push({ level: "danger", reason: Reason.DiscardsChanges });
            } else {
                findings.push({ level: "caution", reason: Reason.RewritesHistory });
            }
            return;
        case "clean":
            if (hasFlag(rest, ["f"], ["--force"])) {
                findings.push({ level: "danger", reason: Reason.DeletesFiles });
            }
            return;
        case "checkout":
            if (rest.includes("--") || rest.includes(".") || hasFlag(rest, ["f"], ["--force"])) {
                findings.push({ level: "danger", reason: Reason.DiscardsChanges });
            } else {
                findings.push({ level: "caution", reason: Reason.ChangesRepo });
            }
            return;
        case "restore":
            if (!rest.includes("--staged") || rest.includes("--worktree")) {
                findings.push({ level: "danger", reason: Reason.DiscardsChanges });
            } else {
                findings.push({ level: "caution", reason: Reason.ChangesRepo });
            }
            return;
        case "stash":
            if (rest[0] === "drop" || rest[0] === "clear") {
                findings.push({ level: "danger", reason: Reason.DiscardsChanges });
            } else {
                findings.push({ level: "caution", reason: Reason.ChangesRepo });
            }
            return;
        case "branch":
            if (hasFlag(rest, ["D"], []) || (hasFlag(rest, ["d"], ["--delete"]) && hasFlag(rest, ["f"], ["--force"]))) {
                findings.push({ level: "danger", reason: Reason.DeletesBranch });
            } else if (hasFlag(rest, ["d", "m", "M"], ["--delete", "--move"])) {
                findings.push({ level: "caution", reason: Reason.ChangesRepo });
            }
            return;
        case "rebase":
        case "filter-branch":
        case "filter-repo":
            findings.push({ level: "caution", reason: Reason.RewritesHistory });
            return;
        case "commit":
            findings.push({
                level: "caution",
                reason: rest.includes("--amend") ? Reason.RewritesHistory : Reason.ChangesRepo,
            });
            return;
        case "clone":
        case "fetch":
        case "pull":
        case "submodule":
            findings.push({ level: "caution", reason: Reason.Network });
            return;
        case "remote":
            if (rest[0] === "update") {
                findings.push({ level: "caution", reason: Reason.Network });
            } else if (rest[0] && rest[0] !== "-v" && rest[0] !== "show" && rest[0] !== "get-url") {
                findings.push({ level: "caution", reason: Reason.ChangesRepo });
            }
            return;
        case "add":
        case "rm":
        case "mv":
        case "merge":
        case "cherry-pick":
        case "revert":
        case "switch":
        case "apply":
        case "am":
        case "tag":
        case "init":
            findings.push({ level: "caution", reason: Reason.ChangesRepo });
            return;
        case "config":
            if (
                !hasFlag(rest, ["l"], ["--get", "--get-all", "--list", "--get-regexp", "--show-origin"]) &&
                positionalArgs(rest).length >= 2
            ) {
                findings.push({ level: "caution", reason: Reason.ChangesRepo });
            }
            return;
    }
}

function classifyDocker(program: string, args: string[], findings: Finding[]) {
    const sub = args.find((arg) => !arg.startsWith("-"));
    const rest = sub == null ? [] : args.slice(args.indexOf(sub) + 1);
    const next = rest.find((arg) => !arg.startsWith("-"));
    if (sub === "rm" || sub === "rmi" || (sub === "system" && next === "prune")) {
        findings.push({ level: "danger", reason: Reason.DeletesResources });
        return;
    }
    if (["volume", "image", "container", "network", "builder", "buildx"].includes(sub)) {
        if (next === "rm" || next === "prune" || next === "remove") {
            findings.push({ level: "danger", reason: Reason.DeletesResources });
        } else if (next === "create") {
            findings.push({ level: "caution", reason: Reason.Containers });
        }
        return;
    }
    if (sub === "compose" || program === "docker-compose") {
        const action = program === "docker-compose" ? sub : next;
        if (action === "down" && (rest.includes("-v") || rest.includes("--volumes"))) {
            findings.push({ level: "danger", reason: Reason.DeletesResources });
        } else if (["up", "down", "rm", "restart", "stop", "start", "build", "pull", "run", "exec"].includes(action)) {
            findings.push({ level: "caution", reason: Reason.Containers });
        }
        return;
    }
    if (sub === "push") {
        findings.push({ level: "caution", reason: Reason.Publishes });
        return;
    }
    if (sub === "pull" || sub === "login") {
        findings.push({ level: "caution", reason: Reason.Network });
        return;
    }
    if (["run", "build", "exec", "stop", "kill", "start", "restart", "create", "cp", "tag", "commit"].includes(sub)) {
        findings.push({ level: "caution", reason: Reason.Containers });
    }
}

function classifyKubectl(args: string[], findings: Finding[]) {
    const sub = args.find((arg) => !arg.startsWith("-"));
    if (sub === "delete" || sub === "drain") {
        findings.push({ level: "danger", reason: Reason.DeletesResources });
        return;
    }
    if (
        [
            "apply",
            "create",
            "patch",
            "replace",
            "scale",
            "edit",
            "set",
            "label",
            "annotate",
            "cordon",
            "taint",
        ].includes(sub) ||
        (sub === "rollout" && args.includes("restart")) ||
        sub === "exec"
    ) {
        findings.push({ level: "caution", reason: Reason.Cluster });
    }
}

function classifyCloud(program: string, args: string[], findings: Finding[]) {
    const words = args.filter((arg) => !arg.startsWith("-")).map((arg) => arg.toLowerCase());
    const destroys = words.some((word) =>
        /^(delete|destroy|remove|rm|rb|terminate|terminate-instances|delete-.*|purge|uninstall)$/.test(word)
    );
    if (program === "terraform" || program === "tofu") {
        if (words[0] === "destroy" || (words[0] === "apply" && args.includes("-destroy"))) {
            findings.push({ level: "danger", reason: Reason.DeletesResources });
        } else if (words[0] === "apply" || words[0] === "import") {
            findings.push({ level: "caution", reason: Reason.Cluster });
        }
        return;
    }
    if (program === "helm") {
        if (words[0] === "uninstall" || words[0] === "delete") {
            findings.push({ level: "danger", reason: Reason.DeletesResources });
        } else if (["install", "upgrade", "rollback"].includes(words[0])) {
            findings.push({ level: "caution", reason: Reason.Cluster });
        }
        return;
    }
    if (program === "gh") {
        if (destroys) {
            findings.push({ level: "danger", reason: Reason.DeletesResources });
        } else if (words.includes("create") || words.includes("merge") || words.includes("edit")) {
            findings.push({ level: "caution", reason: Reason.Publishes });
        }
        return;
    }
    if (destroys) {
        findings.push({ level: "danger", reason: Reason.DeletesResources });
        return;
    }
    findings.push({ level: "caution", reason: Reason.Network });
}

function chmodMode(args: string[]): string {
    return positionalArgs(args)[0] ?? "";
}

function isWorldWritableMode(mode: string): boolean {
    if (/^[0-7]{3,4}$/.test(mode)) {
        const other = Number(mode[mode.length - 1]);
        return (other & 2) === 2;
    }
    return /(^|,)(o|a)?[+=][rwxXst]*w/.test(mode) && /(^|,)(o|a)[+=]|(^|,)\+/.test(mode);
}

function classifyRedirects(redirects: Redirect[], findings: Finding[]) {
    for (const redirect of redirects) {
        if (!redirect.op.includes(">") || redirect.op.endsWith("&")) {
            continue;
        }
        const target = redirect.target;
        if (target === "" || target === "/dev/null" || target === "/dev/stdout" || target === "/dev/stderr") {
            continue;
        }
        if (target.startsWith("/dev/tty") || target.startsWith("/dev/fd/")) {
            continue;
        }
        if (BlockDevicePattern.test(target)) {
            findings.push({ level: "danger", reason: Reason.ErasesDisk });
            continue;
        }
        if (SystemPathPattern.test(target)) {
            findings.push({ level: "danger", reason: Reason.SystemFile });
            continue;
        }
        findings.push({
            level: "caution",
            reason: redirect.op.includes(">>") ? Reason.WritesFiles : Reason.OverwritesFile,
        });
    }
}

function classifyProgram(words: string[], segment: Segment, findings: Finding[], nested: string[]) {
    const program = baseProgram(words[0]);
    const args = words.slice(1);

    if (program === "su" || program === "pkexec") {
        findings.push({ level: "danger", reason: Reason.Admin });
        const commandIndex = args.findIndex((arg) => arg === "-c" || arg === "--command");
        if (commandIndex >= 0 && args[commandIndex + 1]) {
            nested.push(args[commandIndex + 1]);
        }
        return;
    }
    if (ShellPrograms.has(program)) {
        const commandIndex = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
        if (commandIndex >= 0 && args[commandIndex + 1] != null) {
            nested.push(args[commandIndex + 1]);
        }
    }
    const runsCode = Interpreters.has(program) || program === "eval" || program === "source" || program === ".";
    if (runsCode && args.some((arg) => /(\$\(|`|<\()/.test(arg) && DownloadWordPattern.test(arg))) {
        findings.push({ level: "danger", reason: Reason.RemoteCode });
    }
    if (program === "eval") {
        nested.push(args.join(" "));
    }
    if (Interpreters.has(program) && segment.pipedFrom != null) {
        const from = unwrapCommand(segment.pipedFrom.words).words;
        if (from.length > 0 && Downloaders.has(baseProgram(from[0]))) {
            findings.push({ level: "danger", reason: Reason.RemoteCode });
        }
    }

    if (DeletePrograms.has(program)) {
        findings.push({ level: "danger", reason: Reason.DeletesFiles });
        return;
    }
    if (DiskPrograms.has(program) || /^mkfs(\.|$)/.test(program) || program === "newfs") {
        findings.push({ level: "danger", reason: Reason.ErasesDisk });
        return;
    }
    if (program === "diskutil") {
        const sub = (args[0] ?? "").toLowerCase();
        if (/^(erase|zero|partition|reformat|secureerase|apfs)/.test(sub) || sub === "unmountdisk") {
            findings.push({ level: "danger", reason: Reason.ErasesDisk });
        }
        return;
    }
    if (["shutdown", "reboot", "halt", "poweroff"].includes(program)) {
        findings.push({ level: "danger", reason: Reason.Shutdown });
        return;
    }
    if (program === "init" && (args[0] === "0" || args[0] === "6")) {
        findings.push({ level: "danger", reason: Reason.Shutdown });
        return;
    }
    if (program === "systemctl" || program === "service" || program === "launchctl") {
        if (program === "systemctl" && ["poweroff", "reboot", "halt", "kexec", "suspend"].includes(args[0])) {
            findings.push({ level: "danger", reason: Reason.Shutdown });
            return;
        }
        const sub = positionalArgs(args)[program === "service" ? 1 : 0];
        if (
            sub &&
            !["status", "list", "list-units", "list-unit-files", "show", "cat", "is-active", "print"].includes(sub)
        ) {
            findings.push({ level: "caution", reason: Reason.Services });
        }
        return;
    }
    if (program === "kill") {
        const forceful =
            args.some((arg) => /^-(9|KILL|SIGKILL|s\s*KILL)$/i.test(arg)) || args.join(" ").includes("-s KILL");
        findings.push({
            level: forceful ? "danger" : "caution",
            reason: forceful ? Reason.KillsProcesses : Reason.StopsProcess,
        });
        return;
    }
    if (program === "killall" || program === "pkill" || program === "skill") {
        findings.push({ level: "danger", reason: Reason.KillsProcesses });
        return;
    }
    if (
        program === "chmod" ||
        program === "chown" ||
        program === "chgrp" ||
        program === "chattr" ||
        program === "chflags"
    ) {
        if (hasFlag(args, ["R"], ["--recursive"])) {
            findings.push({ level: "danger", reason: Reason.RecursivePermissions });
        } else if (program === "chmod" && isWorldWritableMode(chmodMode(args))) {
            findings.push({ level: "danger", reason: Reason.WorldWritable });
        } else {
            findings.push({ level: "caution", reason: Reason.Permissions });
        }
        if (program === "chmod" && hasFlag(args, ["R"], ["--recursive"]) && isWorldWritableMode(chmodMode(args))) {
            findings.push({ level: "danger", reason: Reason.WorldWritable });
        }
        return;
    }
    if (program === "find") {
        if (args.includes("-delete")) {
            findings.push({ level: "danger", reason: Reason.DeletesFiles });
        }
        for (let i = 0; i < args.length; i++) {
            if (["-exec", "-execdir", "-ok", "-okdir"].includes(args[i])) {
                const end = args.findIndex((arg, j) => j > i && (arg === ";" || arg === "+"));
                nested.push(
                    args
                        .slice(i + 1, end < 0 ? args.length : end)
                        .filter((arg) => arg !== "{}")
                        .map(quoteWord)
                        .join(" ")
                );
            }
        }
        return;
    }
    if (program === "crontab") {
        if (hasFlag(args, ["r"])) {
            findings.push({ level: "danger", reason: Reason.Crontab });
        } else if (args.length > 0 && !hasFlag(args, ["l"])) {
            findings.push({ level: "caution", reason: Reason.Settings });
        }
        return;
    }
    if (program === "iptables" || program === "ip6tables" || program === "nft") {
        if (hasFlag(args, ["F", "X"], ["--flush", "flush"]) || args.includes("flush")) {
            findings.push({ level: "danger", reason: Reason.Firewall });
        } else if (!hasFlag(args, ["L", "S"], ["--list"])) {
            findings.push({ level: "caution", reason: Reason.Settings });
        }
        return;
    }
    if (program === "ufw") {
        if (args[0] === "disable" || args[0] === "reset") {
            findings.push({ level: "danger", reason: Reason.Firewall });
        } else if (args[0] && args[0] !== "status") {
            findings.push({ level: "caution", reason: Reason.Settings });
        }
        return;
    }
    if (program === "git") {
        classifyGit(args, findings);
        return;
    }
    if (program === "docker" || program === "podman" || program === "nerdctl" || program === "docker-compose") {
        classifyDocker(program, args, findings);
        return;
    }
    if (program === "kubectl" || program === "oc" || program === "k") {
        classifyKubectl(args, findings);
        return;
    }
    if (
        ["terraform", "tofu", "helm", "gh", "aws", "gcloud", "gsutil", "az", "doctl", "flyctl", "heroku"].includes(
            program
        )
    ) {
        classifyCloud(program, args, findings);
        return;
    }
    if (
        PackageRunners.has(program) ||
        (program === "pnpm" && args[0] === "dlx") ||
        (program === "pipx" && args[0] === "run")
    ) {
        findings.push({ level: "caution", reason: Reason.RunsPackage });
        return;
    }
    const packageVerbs = PackageManagers[program];
    if (packageVerbs != null) {
        const verb = positionalArgs(args)[0];
        if (program === "pacman" || (verb != null && packageVerbs.has(verb))) {
            findings.push({ level: "caution", reason: Reason.Installs });
        } else if (
            (program === "npm" || program === "cargo" || program === "yarn" || program === "pnpm") &&
            verb === "publish"
        ) {
            findings.push({ level: "caution", reason: Reason.Publishes });
        }
        return;
    }
    if (program === "pacman" || program === "yay" || program === "paru") {
        if (hasFlag(args, ["S", "R", "U"])) {
            findings.push({ level: "caution", reason: Reason.Installs });
        }
        return;
    }
    if (program === "twine" && args[0] === "upload") {
        findings.push({ level: "caution", reason: Reason.Publishes });
        return;
    }
    if (program === "rsync") {
        if (
            args.includes("--delete") ||
            args.some((arg) => arg.startsWith("--delete") || arg === "--remove-source-files")
        ) {
            findings.push({ level: "danger", reason: Reason.DeletesFiles });
        }
        const remote = positionalArgs(args).some((arg) => /^[^/]*:/.test(arg) || arg.startsWith("rsync://"));
        findings.push({ level: "caution", reason: remote ? Reason.Network : Reason.WritesFiles });
        return;
    }
    if (NetworkPrograms.has(program)) {
        findings.push({ level: "caution", reason: Reason.Network });
        if ((program === "curl" || program === "wget") && hasFlag(args, ["o", "O"], ["--output", "--remote-name"])) {
            findings.push({ level: "caution", reason: Reason.WritesFiles });
        }
        return;
    }
    if (WritePrograms.has(program)) {
        if (program === "mv" && positionalArgs(args).at(-1) === "/dev/null") {
            findings.push({ level: "danger", reason: Reason.DeletesFiles });
            return;
        }
        findings.push({ level: "caution", reason: Reason.WritesFiles });
        return;
    }
    if (
        (program === "sed" || program === "perl") &&
        args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place"))
    ) {
        findings.push({ level: "caution", reason: Reason.WritesFiles });
        return;
    }
    if (program === "tar" && isTarWriteMode(args)) {
        findings.push({ level: "caution", reason: Reason.WritesFiles });
        return;
    }
    if (["unzip", "gunzip", "bunzip2", "unxz", "7z", "zip", "gzip"].includes(program)) {
        findings.push({ level: "caution", reason: Reason.WritesFiles });
        return;
    }
    if (program === "defaults" && ["write", "delete", "import"].includes(args[0])) {
        findings.push({ level: "caution", reason: Reason.Settings });
        return;
    }
    if (["sysctl", "scutil", "networksetup", "nvram", "pmset", "csrutil", "spctl", "tmutil"].includes(program)) {
        if (
            args.some(
                (arg) =>
                    arg === "-w" || /^-?-?set/i.test(arg) || arg.includes("=") || arg === "disable" || arg === "delete"
            )
        ) {
            findings.push({ level: "caution", reason: Reason.Settings });
        }
        return;
    }
    if (program === "redis-cli" && args.some((arg) => /^flush(all|db)$/i.test(arg))) {
        findings.push({ level: "danger", reason: Reason.DeletesData });
    }
}

function isTarWriteMode(args: string[]): boolean {
    if (args.some((arg) => /^--(extract|get|create|append|update|delete)$/.test(arg))) {
        return true;
    }
    const mode = args.find((arg, index) => /^-[A-Za-z]+$/.test(arg) || (index === 0 && /^[A-Za-z]+$/.test(arg)));
    return mode != null && /[xcru]/.test(mode.replace(/^-/, ""));
}

function quoteWord(word: string): string {
    if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(word)) {
        return word;
    }
    return `'${word.replace(/'/g, `'\\''`)}'`;
}

const DestructiveSqlPattern =
    /\b(drop\s+(table|database|schema|index|view|user|role|collection)|truncate\s+(table\s+)?[a-z_"`[]|delete\s+from\s+[^\s;]+\s*(;|$|"|'))/im;

function classifyText(text: string, findings: Finding[], depth: number) {
    if (depth > MaxNestingDepth) {
        return;
    }
    if (/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/.test(text)) {
        findings.push({ level: "danger", reason: Reason.ForkBomb });
    }
    if (DestructiveSqlPattern.test(text) || /\.dropDatabase\s*\(|\bflushall\b/i.test(text)) {
        findings.push({ level: "danger", reason: Reason.DeletesData });
    }
    const { segments, nested } = parseShell(text);
    for (const segment of segments) {
        classifyRedirects(segment.redirects, findings);
        const { words, admin } = unwrapCommand(segment.words);
        if (admin) {
            findings.push({ level: "danger", reason: Reason.Admin });
        }
        if (words.length === 0) {
            continue;
        }
        const program = baseProgram(words[0]);
        if (AdminPrograms.has(program) && program !== "su" && program !== "pkexec") {
            continue;
        }
        classifyProgram(words, segment, findings, nested);
    }
    for (const body of nested) {
        classifyText(body, findings, depth + 1);
    }
}

export function classifyCommandRisk(command: string): CommandRisk {
    const text = normalizeCommandText(command).trim();
    if (!text) {
        return { level: "safe", reasons: [] };
    }
    const findings: Finding[] = [];
    classifyText(text, findings, 0);
    const danger = [...new Set(findings.filter((f) => f.level === "danger").map((f) => f.reason))];
    const caution = [...new Set(findings.filter((f) => f.level === "caution").map((f) => f.reason))].filter(
        (reason) => !danger.includes(reason)
    );
    if (danger.length > 0) {
        return { level: "danger", reasons: [...danger, ...caution] };
    }
    if (caution.length > 0) {
        return { level: "caution", reasons: caution };
    }
    return { level: "safe", reasons: [] };
}

export function commandHasHiddenCharacters(command: string): boolean {
    ZeroWidthPattern.lastIndex = 0;
    return ZeroWidthPattern.test(command ?? "");
}
