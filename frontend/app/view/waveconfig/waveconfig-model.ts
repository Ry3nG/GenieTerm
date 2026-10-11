// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { normalizeAppIconVariant } from "@/app/app-icon";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { makeORef } from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { CommandAiSettingsContent } from "@/app/view/waveconfig/commandaicontent";
import { ConnectionsContent } from "@/app/view/waveconfig/connectionscontent";
import { GeneralSettingsContent, updateSettingsJsonValue } from "@/app/view/waveconfig/generalcontent";
import { SecretsContent } from "@/app/view/waveconfig/secretscontent";
import type { GeneralSettingKey, WaveConfigEnv } from "@/app/view/waveconfig/waveconfigenv";
import { base64ToString, stringToBase64 } from "@/util/util";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import * as React from "react";

const LazyWaveConfigView = React.lazy(() =>
    import("@/app/view/waveconfig/waveconfig").then(({ WaveConfigView }) => ({ default: WaveConfigView }))
);

type ValidationResult = { success: true } | { error: string };
type ConfigValidator = (parsed: any) => ValidationResult;

export type ConfigFile = {
    name: string;
    path: string;
    language?: string;
    deprecated?: boolean;
    // reachable by path (e.g. "Edit widgets.json" on the widget rail) but not listed in the sidebar
    hidden?: boolean;
    description?: string;
    docsUrl?: string;
    validator?: ConfigValidator;
    isSecrets?: boolean;
    // a settings page that isn't backed by a config file
    isVirtual?: boolean;
    hasJsonView?: boolean;
    visualComponent?: React.ComponentType<{ model: WaveConfigViewModel }>;
};

export const SecretNameRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

function makeConfigFiles(isWindows: boolean): ConfigFile[] {
    return [
        {
            name: "General",
            path: "settings.json",
            language: "json",
            docsUrl: "https://github.com/Ry3nG/GenieTerm",
            hasJsonView: true,
            visualComponent: GeneralSettingsContent,
        },
        {
            name: "Connections",
            path: "connections.json",
            language: "json",
            docsUrl: "https://github.com/Ry3nG/GenieTerm",
            description: isWindows ? "SSH hosts and WSL distros" : "SSH hosts",
            hasJsonView: true,
            visualComponent: ConnectionsContent,
        },
        {
            name: "Command AI",
            path: "commandai",
            isVirtual: true,
            hasJsonView: false,
            visualComponent: CommandAiSettingsContent,
        },
        {
            name: "Widgets",
            path: "widgets.json",
            language: "json",
            docsUrl: "https://github.com/Ry3nG/GenieTerm",
            hasJsonView: true,
            hidden: true,
        },
        {
            name: "Tab Backgrounds",
            path: "backgrounds.json",
            language: "json",
            docsUrl: "https://github.com/Ry3nG/GenieTerm",
            hasJsonView: true,
            hidden: true,
        },
        {
            name: "Secrets",
            path: "secrets",
            isSecrets: true,
            hasJsonView: false,
            visualComponent: SecretsContent,
        },
    ];
}

const deprecatedConfigFiles: ConfigFile[] = [
    {
        name: "Presets",
        path: "presets.json",
        language: "json",
        deprecated: true,
        hasJsonView: true,
    },
];

export class WaveConfigViewModel implements ViewModel {
    blockId: string;
    viewType = "waveconfig";
    viewIcon = atom("gear");
    viewName = atom("Settings");
    viewComponent = LazyWaveConfigView;
    noPadding = atom(true);
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: WaveConfigEnv;
    generalSettingsSaveQueue = Promise.resolve(true);
    pendingGeneralSettings = 0;

    selectedFileAtom: PrimitiveAtom<ConfigFile>;
    fileContentAtom: PrimitiveAtom<string>;
    originalContentAtom: PrimitiveAtom<string>;
    hasEditedAtom: PrimitiveAtom<boolean>;
    isLoadingAtom: PrimitiveAtom<boolean>;
    isSavingAtom: PrimitiveAtom<boolean>;
    errorMessageAtom: PrimitiveAtom<string>;
    validationErrorAtom: PrimitiveAtom<string>;
    isMenuOpenAtom: PrimitiveAtom<boolean>;
    presetsJsonExistsAtom: PrimitiveAtom<boolean>;
    activeTabAtom: PrimitiveAtom<"visual" | "json">;
    configErrorFilesAtom: Atom<Set<string>>;
    configDir: string;
    saveShortcut: string;
    editorRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;

    secretNamesAtom: PrimitiveAtom<string[]>;
    selectedSecretAtom: PrimitiveAtom<string | null>;
    secretValueAtom: PrimitiveAtom<string>;
    secretShownAtom: PrimitiveAtom<boolean>;
    isAddingNewAtom: PrimitiveAtom<boolean>;
    newSecretNameAtom: PrimitiveAtom<string>;
    newSecretValueAtom: PrimitiveAtom<string>;
    storageBackendErrorAtom: PrimitiveAtom<string | null>;
    secretValueRef: HTMLTextAreaElement | null = null;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv as WaveConfigEnv;
        this.configDir = this.env.electron.getConfigDir();
        const platform = this.env.electron.getPlatform();
        this.saveShortcut = platform === "darwin" ? "Cmd+S" : "Alt+S";

        this.selectedFileAtom = atom(null) as PrimitiveAtom<ConfigFile>;
        this.fileContentAtom = atom("");
        this.originalContentAtom = atom("");
        this.hasEditedAtom = atom(false);
        this.isLoadingAtom = atom(false);
        this.isSavingAtom = atom(false);
        this.errorMessageAtom = atom(null) as PrimitiveAtom<string>;
        this.validationErrorAtom = atom(null) as PrimitiveAtom<string>;
        this.isMenuOpenAtom = atom(false);
        this.presetsJsonExistsAtom = atom(false);
        this.activeTabAtom = atom<"visual" | "json">("visual");
        this.configErrorFilesAtom = atom((get) => {
            const fullConfig = get(this.env.atoms.fullConfigAtom);
            const errorSet = new Set<string>();
            for (const cerr of fullConfig?.configerrors ?? []) {
                errorSet.add(cerr.file);
            }
            return errorSet;
        });
        this.editorRef = React.createRef();

        this.secretNamesAtom = atom<string[]>([]);
        this.selectedSecretAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
        this.secretValueAtom = atom<string>("");
        this.secretShownAtom = atom<boolean>(false);
        this.isAddingNewAtom = atom<boolean>(false);
        this.newSecretNameAtom = atom<string>("");
        this.newSecretValueAtom = atom<string>("");
        this.storageBackendErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

        this.checkPresetsJsonExists();
        this.initialize();
    }

    async checkPresetsJsonExists() {
        try {
            const fullPath = `${this.configDir}/presets.json`;
            const fileInfo = await this.env.rpc.FileInfoCommand(TabRpcClient, {
                info: { path: fullPath },
            });
            if (!fileInfo.notfound) {
                globalStore.set(this.presetsJsonExistsAtom, true);
            }
        } catch {
            // File doesn't exist
        }
    }

    initialize() {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (!selectedFile) {
            const metaFileAtom = this.env.getBlockMetaKeyAtom(this.blockId, "file");
            const savedFilePath = globalStore.get(metaFileAtom);
            const configFiles = this.getConfigFiles();
            const deprecatedConfigFiles = this.getDeprecatedConfigFiles();

            let fileToLoad: ConfigFile | null = null;
            if (savedFilePath) {
                fileToLoad =
                    configFiles.find((f) => f.path === savedFilePath) ||
                    deprecatedConfigFiles.find((f) => f.path === savedFilePath) ||
                    null;
            }

            if (!fileToLoad) {
                fileToLoad = configFiles[0];
            }

            if (fileToLoad) {
                this.loadFile(fileToLoad);
            }
        }
    }

    getConfigFiles(): ConfigFile[] {
        return makeConfigFiles(this.env.isWindows());
    }

    getDeprecatedConfigFiles(): ConfigFile[] {
        const presetsJsonExists = globalStore.get(this.presetsJsonExistsAtom);
        return deprecatedConfigFiles.filter((f) => {
            if (f.path === "presets.json") {
                return presetsJsonExists;
            }
            return true;
        });
    }

    hasChanges(): boolean {
        return globalStore.get(this.hasEditedAtom);
    }

    confirmDiscardChanges(): boolean {
        if (!this.hasChanges()) {
            return true;
        }
        return window.confirm("You have unsaved changes. Discard and continue?");
    }

    discardChanges() {
        const originalContent = globalStore.get(this.originalContentAtom);
        globalStore.set(this.fileContentAtom, originalContent);
        globalStore.set(this.hasEditedAtom, false);
        globalStore.set(this.validationErrorAtom, null);
        globalStore.set(this.errorMessageAtom, null);
    }

    markAsEdited() {
        globalStore.set(this.hasEditedAtom, true);
    }

    async loadFile(file: ConfigFile) {
        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);
        globalStore.set(this.hasEditedAtom, false);

        if (file.isVirtual) {
            globalStore.set(this.selectedFileAtom, file);
            this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { file: file.path },
            });
            globalStore.set(this.isLoadingAtom, false);
            return;
        }

        if (file.isSecrets) {
            globalStore.set(this.selectedFileAtom, file);
            this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { file: file.path },
            });
            globalStore.set(this.isLoadingAtom, false);
            this.checkStorageBackend();
            this.refreshSecrets();
            return;
        }

        try {
            const fullPath = `${this.configDir}/${file.path}`;
            const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
                info: { path: fullPath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            globalStore.set(this.originalContentAtom, content);
            if (content.trim() === "") {
                globalStore.set(this.fileContentAtom, "{\n\n}");
            } else {
                globalStore.set(this.fileContentAtom, content);
            }
            globalStore.set(this.selectedFileAtom, file);
            this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { file: file.path },
            });
        } catch (err) {
            globalStore.set(this.errorMessageAtom, `Failed to load ${file.name}: ${err.message || String(err)}`);
            globalStore.set(this.fileContentAtom, "");
            globalStore.set(this.originalContentAtom, "");
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    saveGeneralSetting(key: GeneralSettingKey, value: string | number | boolean): Promise<boolean> {
        if (
            (globalStore.get(this.isSavingAtom) && this.pendingGeneralSettings === 0) ||
            globalStore.get(this.isLoadingAtom)
        ) {
            return Promise.resolve(false);
        }
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (selectedFile?.path !== "settings.json") {
            return Promise.resolve(false);
        }
        this.pendingGeneralSettings++;
        globalStore.set(this.isSavingAtom, true);
        const saving = this.generalSettingsSaveQueue
            .then(() => this.persistGeneralSetting(selectedFile, key, value))
            .finally(() => {
                this.pendingGeneralSettings--;
                globalStore.set(this.isSavingAtom, this.pendingGeneralSettings > 0);
            });
        this.generalSettingsSaveQueue = saving;
        return saving;
    }

    async persistGeneralSetting(
        selectedFile: ConfigFile,
        key: GeneralSettingKey,
        value: string | number | boolean
    ): Promise<boolean> {
        globalStore.set(this.errorMessageAtom, null);
        try {
            const savedValue = key === "term:fontfamily" && value === "" ? null : value;
            await this.env.rpc.SetConfigCommand(TabRpcClient, { [key]: savedValue });
            if (key === "app:icon") {
                this.env.electron.setAppIconVariant(normalizeAppIconVariant(value));
            }
            // Keep the exact disk formatting for assertFileUnchanged, even though the editor formats JSON differently.
            const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
                info: { path: `${this.configDir}/settings.json` },
            });
            if (globalStore.get(this.selectedFileAtom) !== selectedFile || globalStore.get(this.isLoadingAtom)) {
                return true;
            }
            const diskContent = fileData?.data64 ? base64ToString(fileData.data64) : "";
            const hasEdits = globalStore.get(this.hasEditedAtom);
            // Null removes an override on the server; the fresh disk content already reflects that deletion.
            const nextContent =
                savedValue == null ? diskContent : updateSettingsJsonValue(diskContent, key, savedValue);
            if (!hasEdits) {
                globalStore.set(this.fileContentAtom, nextContent);
            }
            globalStore.set(this.originalContentAtom, diskContent);
            globalStore.set(this.hasEditedAtom, hasEdits);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            globalStore.set(this.errorMessageAtom, `Failed to save ${key}: ${message}`);
            return false;
        }
    }

    async refreshConnectionsFile(expectedContent: string): Promise<boolean> {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (selectedFile?.path !== "connections.json") {
            return false;
        }
        const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
            info: { path: `${this.configDir}/${selectedFile.path}` },
        });
        const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
        if (globalStore.get(this.fileContentAtom) !== expectedContent) {
            globalStore.set(this.hasEditedAtom, true);
            globalStore.set(
                this.errorMessageAtom,
                "Connections changed on disk. Review your Raw JSON edits before saving."
            );
            return false;
        }
        globalStore.set(this.fileContentAtom, content.trim() === "" ? "{\n\n}" : content);
        globalStore.set(this.originalContentAtom, content);
        globalStore.set(this.hasEditedAtom, false);
        return true;
    }

    async assertFileUnchanged(file: ConfigFile): Promise<void> {
        const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
            info: { path: `${this.configDir}/${file.path}` },
        });
        const currentContent = fileData?.data64 ? base64ToString(fileData.data64) : "";
        if (currentContent !== globalStore.get(this.originalContentAtom)) {
            throw new Error(`${file.name} changed on disk. Reload and review the latest version before saving.`);
        }
    }

    async saveFile() {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (!selectedFile) return;

        const fileContent = globalStore.get(this.fileContentAtom);

        if (fileContent.trim() === "") {
            globalStore.set(this.isSavingAtom, true);
            globalStore.set(this.errorMessageAtom, null);
            globalStore.set(this.validationErrorAtom, null);

            try {
                const fullPath = `${this.configDir}/${selectedFile.path}`;
                await this.assertFileUnchanged(selectedFile);
                await this.env.rpc.FileWriteCommand(TabRpcClient, {
                    info: { path: fullPath },
                    data64: stringToBase64(""),
                });
                globalStore.set(this.fileContentAtom, "");
                globalStore.set(this.originalContentAtom, "");
                globalStore.set(this.hasEditedAtom, false);
            } catch (err) {
                globalStore.set(
                    this.errorMessageAtom,
                    `Failed to save ${selectedFile.name}: ${err.message || String(err)}`
                );
            } finally {
                globalStore.set(this.isSavingAtom, false);
            }
            return;
        }

        try {
            const parsed = JSON.parse(fileContent);

            if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
                globalStore.set(this.validationErrorAtom, "JSON must be an object, not an array, primitive, or null");
                return;
            }

            if (selectedFile.validator) {
                const validationResult = selectedFile.validator(parsed);
                if ("error" in validationResult) {
                    globalStore.set(this.validationErrorAtom, validationResult.error);
                    return;
                }
            }

            const formatted = JSON.stringify(parsed, null, 2);

            globalStore.set(this.isSavingAtom, true);
            globalStore.set(this.errorMessageAtom, null);
            globalStore.set(this.validationErrorAtom, null);

            try {
                const fullPath = `${this.configDir}/${selectedFile.path}`;
                await this.assertFileUnchanged(selectedFile);
                await this.env.rpc.FileWriteCommand(TabRpcClient, {
                    info: { path: fullPath },
                    data64: stringToBase64(formatted),
                });
                globalStore.set(this.fileContentAtom, formatted);
                globalStore.set(this.originalContentAtom, formatted);
                globalStore.set(this.hasEditedAtom, false);
            } catch (err) {
                globalStore.set(
                    this.errorMessageAtom,
                    `Failed to save ${selectedFile.name}: ${err.message || String(err)}`
                );
            } finally {
                globalStore.set(this.isSavingAtom, false);
            }
        } catch (err) {
            globalStore.set(this.validationErrorAtom, `Invalid JSON: ${err.message || String(err)}`);
        }
    }

    clearError() {
        globalStore.set(this.errorMessageAtom, null);
    }

    clearValidationError() {
        globalStore.set(this.validationErrorAtom, null);
    }

    async checkStorageBackend() {
        try {
            const backend = await this.env.rpc.GetSecretsLinuxStorageBackendCommand(TabRpcClient);
            if (backend === "basic_text" || backend === "unknown") {
                globalStore.set(
                    this.storageBackendErrorAtom,
                    "No appropriate secret manager found. Cannot manage secrets securely."
                );
            } else {
                globalStore.set(this.storageBackendErrorAtom, null);
            }
        } catch (error) {
            globalStore.set(this.storageBackendErrorAtom, `Error checking storage backend: ${error.message}`);
        }
    }

    async refreshSecrets() {
        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            const names = await this.env.rpc.GetSecretsNamesCommand(TabRpcClient);
            globalStore.set(this.secretNamesAtom, names || []);
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to load secrets: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async viewSecret(name: string) {
        globalStore.set(this.errorMessageAtom, null);
        globalStore.set(this.selectedSecretAtom, name);
        globalStore.set(this.secretShownAtom, false);
        globalStore.set(this.secretValueAtom, "");
    }

    closeSecretView() {
        globalStore.set(this.selectedSecretAtom, null);
        globalStore.set(this.secretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    async showSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);
        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            const secrets = await this.env.rpc.GetSecretsCommand(TabRpcClient, [selectedSecret]);
            const value = secrets[selectedSecret];
            if (value !== undefined) {
                globalStore.set(this.secretValueAtom, value);
                globalStore.set(this.secretShownAtom, true);
            } else {
                globalStore.set(this.errorMessageAtom, `Secret not found: ${selectedSecret}`);
            }
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to load secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async saveSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);
        const secretValue = globalStore.get(this.secretValueAtom);

        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [selectedSecret]: secretValue });
            this.closeSecretView();
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to save secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async deleteSecret() {
        const selectedSecret = globalStore.get(this.selectedSecretAtom);

        if (!selectedSecret) {
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [selectedSecret]: null });
            this.closeSecretView();
            await this.refreshSecrets();
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to delete secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    startAddingSecret() {
        globalStore.set(this.isAddingNewAtom, true);
        globalStore.set(this.newSecretNameAtom, "");
        globalStore.set(this.newSecretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    cancelAddingSecret() {
        globalStore.set(this.isAddingNewAtom, false);
        globalStore.set(this.newSecretNameAtom, "");
        globalStore.set(this.newSecretValueAtom, "");
        globalStore.set(this.errorMessageAtom, null);
    }

    async addNewSecret() {
        const name = globalStore.get(this.newSecretNameAtom).trim();
        const value = globalStore.get(this.newSecretValueAtom);

        if (!name) {
            globalStore.set(this.errorMessageAtom, "Secret name cannot be empty");
            return;
        }

        if (!SecretNameRegex.test(name)) {
            globalStore.set(
                this.errorMessageAtom,
                "Invalid secret name: must start with a letter and contain only letters, numbers, and underscores"
            );
            return;
        }

        const existingNames = globalStore.get(this.secretNamesAtom);
        if (existingNames.includes(name)) {
            globalStore.set(this.errorMessageAtom, `Secret "${name}" already exists`);
            return;
        }

        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);

        try {
            await this.env.rpc.SetSecretsCommand(TabRpcClient, { [name]: value });
            globalStore.set(this.isAddingNewAtom, false);
            globalStore.set(this.newSecretNameAtom, "");
            globalStore.set(this.newSecretValueAtom, "");
            await this.refreshSecrets();
        } catch (error) {
            globalStore.set(this.errorMessageAtom, `Failed to add secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    giveFocus(): boolean {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (selectedFile?.isSecrets && this.secretValueRef) {
            this.secretValueRef.focus();
            return true;
        }
        if (this.editorRef?.current) {
            this.editorRef.current.focus();
            return true;
        }
        return false;
    }
}
