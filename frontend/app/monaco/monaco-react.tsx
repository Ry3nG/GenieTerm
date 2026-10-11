// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { loadMonaco } from "@/app/monaco/monaco-env";
import type * as MonacoTypes from "monaco-editor";
import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { debounce } from "throttle-debounce";

function createModel(value: string, path: string, language?: string) {
    const uri = monaco.Uri.parse(`wave://editor/${encodeURIComponent(path)}`);
    return monaco.editor.createModel(value, language, uri);
}

type CodeEditorProps = {
    text: string;
    readonly: boolean;
    language?: string;
    onChange?: (text: string) => void;
    onMount?: (editor: MonacoTypes.editor.IStandaloneCodeEditor, monacoApi: typeof monaco) => () => void;
    path: string;
    options: MonacoTypes.editor.IEditorOptions;
};

export function MonacoCodeEditor({ text, readonly, language, onChange, onMount, path, options }: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
    const onUnmountRef = useRef<(() => void) | null>(null);
    const applyingFromProps = useRef(false);

    useEffect(() => {
        loadMonaco();

        const el = divRef.current;
        if (!el) return;

        const model = createModel(text, path, language);
        console.log("[monaco] CREATE MODEL", path, model);

        const editor = monaco.editor.create(el, {
            ...options,
            readOnly: readonly,
            model,
        });
        editorRef.current = editor;

        const sub = model.onDidChangeContent(() => {
            if (applyingFromProps.current) return;
            onChange?.(model.getValue());
        });

        if (onMount) {
            onUnmountRef.current = onMount(editor, monaco);
        }

        return () => {
            sub.dispose();
            if (onUnmountRef.current) onUnmountRef.current();
            editor.setModel(null);
            editor.dispose();
            model.dispose();
            console.log("[monaco] dispose model");
            editorRef.current = null;
        };
        // mount/unmount only
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        const el = divRef.current;
        if (!editor || !el) return;

        const debouncedLayout = debounce(100, () => {
            editor.layout();
        });
        const resizeObserver = new ResizeObserver(debouncedLayout);
        resizeObserver.observe(el);

        return () => {
            resizeObserver.disconnect();
            debouncedLayout.cancel();
        };
    }, []);

    // Keep model value in sync with props
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;

        const current = model.getValue();
        if (current === text) return;

        applyingFromProps.current = true;
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
        applyingFromProps.current = false;
    }, [text]);

    // Keep options in sync
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.updateOptions({ ...options, readOnly: readonly });
    }, [options, readonly]);

    // Keep language in sync
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (!model || !language) return;
        monaco.editor.setModelLanguage(model, language);
    }, [language]);

    return <div className="flex flex-col h-full w-full" ref={divRef} />;
}
