// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

export function getDurableOutputGapMessage(status: BlockJobStatusData): string | null {
    if (!(status?.outputgap > 0)) {
        return null;
    }
    return `${status.outputgap.toLocaleString()} bytes of this session's output could not be recovered after a disconnect. Earlier output may be incomplete.`;
}

export function DurableOutputGapNotice({ status }: { status: BlockJobStatusData }) {
    const message = getDurableOutputGapMessage(status);
    if (message == null) {
        return null;
    }
    return (
        <div
            role="status"
            className="mt-2 max-w-[280px] border-t border-border pt-2 text-xs text-warning leading-relaxed"
        >
            {message}
        </div>
    );
}
