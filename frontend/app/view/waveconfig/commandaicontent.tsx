// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import {
    CommandAiClient,
    CommandAiEngineOrder,
    CommandAiSecretNames,
    makeCommandAiRequestId,
} from "@/app/store/commandai";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { SettingsRow, SettingsSection, SettingsSegmented, SettingsText, SettingsToggle } from "./settingscontrols";

type EngineId = (typeof CommandAiEngineOrder)[number];

type EndpointPreset = { value: string; label: string; baseUrl: string };

const OpenAiPresets: EndpointPreset[] = [
    { value: "openai", label: "OpenAI", baseUrl: "" },
    { value: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
    { value: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
    { value: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
    { value: "custom", label: "Other", baseUrl: "" },
];

const DefaultBaseUrls: Partial<Record<EngineId, string>> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    ollama: "http://127.0.0.1:11434",
};

const EngineDescriptions: Record<EngineId, string> = {
    codex: "Uses the Codex CLI and your ChatGPT sign-in.",
    claude: "Uses Claude Code and your Claude sign-in.",
    ollama: "Runs a model on your own computer or server. Nothing leaves your network.",
    openai: "OpenAI, OpenRouter, Gemini, LM Studio, vLLM, or any server with an OpenAI-style API.",
    anthropic: "Claude models with your own Anthropic API key.",
};

type TestState = { running: boolean; result?: CommandAiResult };

function presetForBaseUrl(baseUrl: string): string {
    if (!baseUrl || baseUrl === DefaultBaseUrls.openai) {
        return "openai";
    }
    return OpenAiPresets.find((preset) => preset.baseUrl && preset.baseUrl === baseUrl)?.value ?? "custom";
}

function engineStatusText(engine: CommandAiEngineInfo): string {
    if (engine == null) {
        return "";
    }
    const ready = engine.available && engine.signedin;
    if (engine.kind === "cli") {
        if (!engine.available) {
            return "Not installed";
        }
        if (!ready) {
            return "Not signed in";
        }
        return [engine.account ? `Signed in · ${engine.account}` : "Signed in", engine.version]
            .filter(Boolean)
            .join(" · ");
    }
    if (engine.kind === "local") {
        if (!engine.available) {
            return engine.detail || "Not running";
        }
        const count = engine.models?.length ?? 0;
        return count === 0 ? "Running · no models yet" : `Running · ${count} ${count === 1 ? "model" : "models"}`;
    }
    return engine.haskey ? "API key saved" : engine.available ? "Ready" : "Needs an API key";
}

function engineIcon(engine: CommandAiEngineInfo): string {
    if (engine.kind === "local") {
        return "fa-microchip";
    }
    if (engine.kind === "api") {
        return "fa-key";
    }
    return "fa-terminal";
}

function CopyCommand({ command }: { command: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-black/25 py-0.5 pr-0.5 pl-2">
            <code className="truncate font-mono text-xs text-primary">{command}</code>
            <button
                type="button"
                title="Copy"
                aria-label={`Copy ${command}`}
                onClick={() => {
                    void navigator.clipboard?.writeText(command);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors hover:bg-white/10 hover:text-primary cursor-pointer"
            >
                <i className={cn("fa-solid text-[11px]", copied ? "fa-check" : "fa-copy")} aria-hidden="true" />
            </button>
        </span>
    );
}

function EngineList({
    status,
    selected,
    onSelect,
    busy,
}: {
    status: CommandAiStatus;
    selected: string;
    onSelect: (engine: EngineId) => void;
    busy: boolean;
}) {
    const engines = CommandAiEngineOrder.map((id) => status?.engines?.find((engine) => engine.id === id)).filter(
        Boolean
    );
    if (status == null) {
        return (
            <div className="flex items-center gap-2 px-4 py-5 text-sm text-secondary">
                <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                Looking for AI tools on this computer…
            </div>
        );
    }
    return (
        <div role="radiogroup" aria-label="AI engine">
            {engines.map((engine) => {
                const isSelected = engine.id === selected;
                const ready = engine.available && engine.signedin;
                return (
                    <button
                        key={engine.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`${engine.label}, ${engineStatusText(engine)}`}
                        aria-disabled={busy}
                        onClick={() => {
                            if (!busy && !isSelected) {
                                onSelect(engine.id as EngineId);
                            }
                        }}
                        className={cn(
                            "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 cursor-pointer",
                            isSelected ? "bg-accent/[0.08]" : "hover:bg-hover"
                        )}
                    >
                        <span
                            className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                isSelected ? "border-accent bg-accent" : "border-white/25"
                            )}
                        >
                            {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                        <i
                            className={cn(
                                "fa-solid w-4 shrink-0 text-center text-[13px]",
                                engineIcon(engine),
                                ready ? "text-secondary" : "text-muted"
                            )}
                            aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium leading-5">{engine.label}</span>
                            <span className="block text-xs leading-5 text-secondary">
                                {EngineDescriptions[engine.id as EngineId]}
                            </span>
                        </span>
                        <span className={cn("shrink-0 text-right text-xs", ready ? "text-secondary" : "text-muted")}>
                            {ready && (
                                <i
                                    className="fa-solid fa-circle mr-1.5 text-[6px] align-middle text-success"
                                    aria-hidden="true"
                                />
                            )}
                            {engineStatusText(engine)}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function ApiKeyRow({
    model,
    engine,
    info,
    secretBackend,
    onChanged,
}: {
    model: WaveConfigViewModel;
    engine: EngineId;
    info: CommandAiEngineInfo;
    secretBackend: string;
    onChanged: () => void;
}) {
    const id = useId();
    const secretName = CommandAiSecretNames[engine];
    const [draft, setDraft] = useState("");
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const insecure = secretBackend === "basic_text" || secretBackend === "unknown";
    const hasKey = info?.haskey ?? false;
    const store = PLATFORM === PlatformMacOS ? "your Keychain" : "your system keyring";

    const save = async (value: string | null) => {
        setBusy(true);
        setError("");
        try {
            await model.env.rpc.SetSecretsCommand(TabRpcClient, { [secretName]: value });
            setDraft("");
            setEditing(false);
            onChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    let description = hasKey ? `Saved in ${store}.` : `Stored in ${store}, never in settings.json.`;
    if (insecure) {
        description = "This system has no keyring, so GenieTerm can't store an API key safely.";
    }
    if (error) {
        description = error;
    }

    let control;
    if (insecure) {
        control = <span className="text-xs text-muted">Unavailable</span>;
    } else if (hasKey && !editing) {
        control = (
            <div className="flex items-center gap-2">
                <span className="font-mono text-xs tracking-widest text-secondary">••••••••</span>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(true)}
                    className="h-8 rounded-md border border-border px-3 text-xs text-primary transition-colors hover:bg-hover cursor-pointer disabled:opacity-60"
                >
                    Replace
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save(null)}
                    className="h-8 rounded-md border border-border px-3 text-xs text-primary transition-colors hover:bg-hover cursor-pointer disabled:opacity-60"
                >
                    Remove
                </button>
            </div>
        );
    } else {
        control = (
            <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim()) {
                        void save(draft.trim());
                    }
                }}
            >
                <input
                    id={id}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft}
                    placeholder={engine === "anthropic" ? "sk-ant-…" : "sk-…"}
                    aria-labelledby={`${id}-label`}
                    aria-describedby={`${id}-description`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape" && hasKey) {
                            setEditing(false);
                            setDraft("");
                        }
                    }}
                    className="h-8 w-48 max-w-full rounded-md border border-border bg-background px-2.5 text-sm text-primary outline-none placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent"
                />
                <button
                    type="submit"
                    disabled={busy || !draft.trim()}
                    className="h-8 rounded-md bg-accent/80 px-3 text-xs font-medium text-primary transition-colors hover:bg-accent cursor-pointer disabled:cursor-default disabled:opacity-40"
                >
                    Save
                </button>
            </form>
        );
    }
    return (
        <SettingsRow id={id} label="API key" description={description}>
            {control}
        </SettingsRow>
    );
}

function ModelRow({
    model,
    engine,
    info,
    value,
    baseUrl,
    onCommit,
}: {
    model: WaveConfigViewModel;
    engine: EngineId;
    info: CommandAiEngineInfo;
    value: string;
    baseUrl: string;
    onCommit: (value: string) => Promise<boolean>;
}) {
    const id = useId();
    const listId = useId();
    const [models, setModels] = useState<string[]>(info?.models ?? []);
    const canList = engine === "ollama" || ((engine === "openai" || engine === "anthropic") && info?.available);
    useEffect(() => {
        if (!canList) {
            setModels([]);
            return;
        }
        let canceled = false;
        model.env.rpc
            .CommandAiModelsCommand(TabRpcClient, { engine, baseurl: baseUrl || undefined }, { timeout: 15000 })
            .then((result) => {
                if (!canceled) {
                    setModels(result?.models ?? []);
                }
            })
            .catch(() => {});
        return () => {
            canceled = true;
        };
    }, [canList, engine, baseUrl, model]);

    let placeholder = info?.defaultmodel || "Required";
    let description = "The model that writes commands. Smaller, faster models work well.";
    if (engine === "codex") {
        placeholder = "From your Codex settings";
        description = "Leave empty to use your Codex default. Command AI asks for low reasoning effort to stay quick.";
    } else if (engine === "claude") {
        placeholder = "From Claude Code";
        description = "Leave empty to use your Claude Code default, or enter an alias such as sonnet or haiku.";
    } else if (engine === "ollama") {
        description =
            models.length > 0
                ? `Installed: ${models.slice(0, 4).join(", ")}${models.length > 4 ? "…" : ""}`
                : "No models installed yet.";
        placeholder = info?.defaultmodel || "llama3.2";
    }
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = async () => {
        const next = draft.trim();
        setDraft(next);
        if (next !== value && !(await onCommit(next))) {
            setDraft(value);
        }
    };
    return (
        <SettingsRow id={id} label="Model" description={description}>
            <input
                id={id}
                type="text"
                list={models.length > 0 ? listId : undefined}
                value={draft}
                placeholder={placeholder}
                spellCheck={false}
                aria-labelledby={`${id}-label`}
                aria-describedby={`${id}-description`}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void commit()}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                        setDraft(value);
                        e.stopPropagation();
                    }
                }}
                className="h-8 w-56 max-w-full rounded-md border border-border bg-background px-2.5 text-sm text-primary outline-none placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent"
            />
            {models.length > 0 && (
                <datalist id={listId}>
                    {models.map((name) => (
                        <option key={name} value={name} />
                    ))}
                </datalist>
            )}
        </SettingsRow>
    );
}

function TestRow({ model, engine, ready }: { model: WaveConfigViewModel; engine: EngineId; ready: boolean }) {
    const id = useId();
    const [test, setTest] = useState<TestState>({ running: false });
    const engineRef = useRef(engine);
    engineRef.current = engine;
    useEffect(() => setTest({ running: false }), [engine]);
    const run = async () => {
        setTest({ running: true });
        let result: CommandAiResult;
        try {
            result = await model.env.rpc.CommandAiRunCommand(
                TabRpcClient,
                {
                    requestid: makeCommandAiRequestId(),
                    task: "compose",
                    prompt: "show the current directory",
                    context: { shell: "zsh", cwd: "~" },
                },
                { timeout: 100000 }
            );
        } catch (e) {
            result = { requestid: "", status: "failed", statusdetail: e instanceof Error ? e.message : String(e) };
        }
        if (engineRef.current === engine) {
            setTest({ running: false, result });
        }
    };
    const result = test.result;
    let description = "Sends a small request to check that everything works.";
    if (test.running) {
        description = "Waiting for an answer…";
    } else if (result?.status === "ok") {
        const command = result.proposals?.[0]?.command;
        description = `Works · ${(result.durationms / 1000).toFixed(1)}s${command ? ` · ${command}` : ""}`;
    } else if (result != null) {
        description = result.statusdetail || "It didn't work. Check the settings above.";
    }
    return (
        <SettingsRow id={id} label="Test" description={description}>
            <button
                id={id}
                type="button"
                disabled={!ready || test.running}
                onClick={() => void run()}
                className={cn(
                    "inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-primary transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50",
                    result?.status === "ok" ? "text-success" : "hover:bg-hover"
                )}
            >
                {test.running && <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />}
                {!test.running && result?.status === "ok" && <i className="fa-solid fa-check" aria-hidden="true" />}
                {test.running ? "Testing" : "Test"}
            </button>
        </SettingsRow>
    );
}

function HostsRow({ model }: { model: WaveConfigViewModel }) {
    const id = useId();
    const fullConfig = useAtomValue(model.env.atoms.fullConfigAtom);
    const [known, setKnown] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let canceled = false;
        model.env.rpc
            .ConnListCommand(TabRpcClient, { timeout: 2000 })
            .then((names) => {
                if (!canceled) {
                    setKnown(names ?? []);
                }
            })
            .catch(() => {});
        return () => {
            canceled = true;
        };
    }, [model]);
    const connections = fullConfig?.connections ?? {};
    const off = Object.keys(connections)
        .filter((name) => connections[name]?.["term:commandcomposer"] === false)
        .sort();
    const candidates = [...new Set([...Object.keys(connections), ...known])]
        .filter((name) => !off.includes(name) && !name.startsWith("wsl://"))
        .sort();
    const setHost = async (host: string, enabled: boolean) => {
        setBusy(true);
        try {
            const metamaptype: unknown = { "term:commandcomposer": enabled ? null : false };
            await model.env.rpc.SetConnectionsConfigCommand(TabRpcClient, { host, metamaptype });
        } finally {
            setBusy(false);
        }
    };
    return (
        <SettingsRow
            id={id}
            label="Hosts where Command AI is off"
            description={
                off.length === 0
                    ? "Turn Command AI off for hosts you'd rather keep out of it, such as production servers."
                    : "Command AI buttons and shortcuts are hidden in terminals on these hosts."
            }
        >
            <div className="flex max-w-[320px] flex-wrap items-center justify-end gap-1.5">
                {off.map((host) => (
                    <span
                        key={host}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-white/[0.06] pr-1 pl-2.5 font-mono text-xs text-primary"
                    >
                        {host}
                        <button
                            type="button"
                            disabled={busy}
                            title={`Turn Command AI back on for ${host}`}
                            aria-label={`Turn Command AI back on for ${host}`}
                            onClick={() => void setHost(host, true)}
                            className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors hover:bg-white/10 hover:text-primary cursor-pointer"
                        >
                            <i className="fa-solid fa-xmark text-[10px]" aria-hidden="true" />
                        </button>
                    </span>
                ))}
                {candidates.length > 0 && (
                    <select
                        id={id}
                        value=""
                        disabled={busy}
                        aria-labelledby={`${id}-label`}
                        onChange={(e) => {
                            if (e.target.value) {
                                void setHost(e.target.value, false);
                            }
                        }}
                        className="h-7 max-w-full rounded-md border border-border bg-background px-2 text-xs text-primary outline-none focus:border-accent cursor-pointer"
                    >
                        <option value="">Add a host…</option>
                        {candidates.map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </select>
                )}
            </div>
        </SettingsRow>
    );
}

const CommandAiSettingsContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const env = model.env;
    const enabled = useAtomValue(env.getSettingsKeyAtom("term:commandcomposer")) !== false;
    const engine = (useAtomValue(env.getSettingsKeyAtom("commandai:engine")) ?? "") as EngineId | "";
    const modelName = useAtomValue(env.getSettingsKeyAtom("commandai:model")) ?? "";
    const baseUrl = useAtomValue(env.getSettingsKeyAtom("commandai:baseurl")) ?? "";
    const includeOutput = useAtomValue(env.getSettingsKeyAtom("commandai:includeoutput")) !== false;
    const inline = useAtomValue(env.getSettingsKeyAtom("commandai:inline")) !== false;
    const [status, setStatus] = useState<CommandAiStatus>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const enabledId = useId();
    const presetId = useId();
    const baseUrlId = useId();
    const outputId = useId();
    const inlineId = useId();

    const loadStatus = useCallback(
        async (refresh: boolean) => {
            setRefreshing(true);
            try {
                setStatus(await env.rpc.CommandAiStatusCommand(TabRpcClient, { refresh }, { timeout: 20000 }));
            } catch (e) {
                console.error("command ai status failed", e);
            } finally {
                setRefreshing(false);
            }
        },
        [env]
    );

    useEffect(() => {
        void loadStatus(false);
    }, [loadStatus, engine, baseUrl]);

    const save = useCallback(
        async (settings: Record<string, unknown>): Promise<boolean> => {
            setSaving(true);
            try {
                await env.rpc.SetConfigCommand(TabRpcClient, settings as SettingsType);
                CommandAiClient.getInstance().invalidateStatus();
                return true;
            } catch (e) {
                console.error("saving command ai settings failed", e);
                return false;
            } finally {
                setSaving(false);
            }
        },
        [env]
    );

    const info = status?.engines?.find((e) => e.id === engine);
    const ready = info != null && info.available && info.signedin;
    const preset = presetForBaseUrl(baseUrl);

    return (
        <div className="h-full overflow-y-auto bg-background text-primary">
            <div className="mx-auto w-full min-w-0 max-w-[768px] space-y-7 p-4 @w600:p-6">
                <div className="px-1">
                    <h1 className="text-xl font-semibold tracking-tight">Command AI</h1>
                    <p className="mt-1 max-w-[620px] text-sm leading-5 text-secondary">
                        Describe what you want and get a command to review, or ask why one failed. GenieTerm has no AI
                        service of its own: it uses the AI you choose here, and sends a request only when you ask.
                        Nothing runs until you run it.
                    </p>
                </div>

                <SettingsSection
                    footer={
                        <>
                            Press {PLATFORM === PlatformMacOS ? "⌘⇧Space" : "Ctrl+Shift+Space"} in a terminal, or use
                            the sparkle button on a finished command.
                        </>
                    }
                >
                    <SettingsRow
                        id={enabledId}
                        label="Use Command AI"
                        description="When this is off, every Command AI button and shortcut is hidden."
                    >
                        <SettingsToggle
                            id={enabledId}
                            value={enabled}
                            busy={saving}
                            onCommit={(value) => save({ "term:commandcomposer": value })}
                        />
                    </SettingsRow>
                </SettingsSection>

                {enabled && (
                    <SettingsSection
                        title="AI"
                        footer={
                            <span className="flex flex-wrap items-center gap-x-2">
                                <span>Looks for tools installed for your user account.</span>
                                <button
                                    type="button"
                                    disabled={refreshing}
                                    onClick={() => void loadStatus(true)}
                                    className="text-accent hover:underline cursor-pointer disabled:opacity-60"
                                >
                                    {refreshing ? "Checking…" : "Check again"}
                                </button>
                            </span>
                        }
                    >
                        <EngineList
                            status={status}
                            selected={engine}
                            busy={saving}
                            onSelect={(next) =>
                                void save({
                                    "commandai:engine": next,
                                    "commandai:model": null,
                                    "commandai:baseurl": null,
                                })
                            }
                        />
                    </SettingsSection>
                )}

                {enabled && engine && info != null && (
                    <SettingsSection title={info.label}>
                        {info.kind === "cli" && !ready && info.fixcommand && (
                            <SettingsRow
                                id={`${engine}-fix`}
                                label={info.available ? "Sign in" : "Install"}
                                description={
                                    info.available
                                        ? `Run this in a terminal on this computer, then choose Check again.`
                                        : `${info.label} isn't installed for your user account. Install it, then choose Check again.`
                                }
                            >
                                <CopyCommand command={info.fixcommand} />
                            </SettingsRow>
                        )}
                        {engine === "ollama" && !info.available && (
                            <SettingsRow
                                id="ollama-fix"
                                label="Start Ollama"
                                description="Ollama isn't answering. Open the Ollama app, or run this:"
                            >
                                <CopyCommand command="ollama serve" />
                            </SettingsRow>
                        )}
                        {engine === "ollama" && info.available && (info.models?.length ?? 0) === 0 && (
                            <SettingsRow
                                id="ollama-pull"
                                label="Download a model"
                                description="Ollama is running but has no models yet. A small coding model is enough."
                            >
                                <CopyCommand command="ollama pull qwen3" />
                            </SettingsRow>
                        )}
                        {engine === "openai" && (
                            <SettingsRow id={presetId} label="Service" description="Fills in the endpoint for you.">
                                <SettingsSegmented
                                    id={presetId}
                                    value={preset}
                                    busy={saving}
                                    options={OpenAiPresets.map((p) => ({ value: p.value, label: p.label }))}
                                    onCommit={(value) => {
                                        const next = OpenAiPresets.find((p) => p.value === value);
                                        if (value === "custom") {
                                            return Promise.resolve(true);
                                        }
                                        return save({
                                            "commandai:baseurl": next?.baseUrl || null,
                                            "commandai:model": null,
                                        });
                                    }}
                                />
                            </SettingsRow>
                        )}
                        {(engine === "openai" || engine === "ollama" || engine === "anthropic") && (
                            <SettingsRow
                                id={baseUrlId}
                                label={engine === "ollama" ? "Server" : "Endpoint"}
                                description={
                                    engine === "ollama"
                                        ? "Where Ollama is listening."
                                        : "The API's base URL. Requests go straight from this computer to it."
                                }
                            >
                                <SettingsText
                                    id={baseUrlId}
                                    value={baseUrl}
                                    busy={saving}
                                    placeholder={DefaultBaseUrls[engine]}
                                    onCommit={(value) => save({ "commandai:baseurl": value || null })}
                                />
                            </SettingsRow>
                        )}
                        {(engine === "openai" || engine === "anthropic") && (
                            <ApiKeyRow
                                model={model}
                                engine={engine}
                                info={info}
                                secretBackend={status?.secretbackend ?? ""}
                                onChanged={() => void loadStatus(true)}
                            />
                        )}
                        <ModelRow
                            model={model}
                            engine={engine}
                            info={info}
                            value={modelName}
                            baseUrl={baseUrl}
                            onCommit={(value) => save({ "commandai:model": value || null })}
                        />
                        <TestRow model={model} engine={engine} ready={ready} />
                    </SettingsSection>
                )}

                {enabled && (
                    <SettingsSection
                        title="Privacy"
                        footer="Before anything is sent, keys, tokens and passwords are replaced with [REDACTED], and “What’s sent” in the Command AI sheet shows the exact request."
                    >
                        <SettingsRow
                            id={outputId}
                            label="Include output when fixing or explaining"
                            description="Sends up to the last 120 lines of that command's output. You can change this for each request."
                        >
                            <SettingsToggle
                                id={outputId}
                                value={includeOutput}
                                busy={saving}
                                onCommit={(value) => save({ "commandai:includeoutput": value })}
                            />
                        </SettingsRow>
                        <SettingsRow
                            id={inlineId}
                            label="Suggest a command for requests typed at the prompt"
                            description="When something like “show disk usage” fails as a command, Command AI offers one instead."
                        >
                            <SettingsToggle
                                id={inlineId}
                                value={inline}
                                busy={saving}
                                onCommit={(value) => save({ "commandai:inline": value })}
                            />
                        </SettingsRow>
                        <HostsRow model={model} />
                    </SettingsSection>
                )}
            </div>
        </div>
    );
});

CommandAiSettingsContent.displayName = "CommandAiSettingsContent";

export { CommandAiSettingsContent };
