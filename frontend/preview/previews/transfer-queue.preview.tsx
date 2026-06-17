import { TransferQueueStatus } from "@/app/view/preview/transfer-queue-status";
import { makeTransferQueuePreviewState } from "./transfer-queue.preview-util";

export function TransferQueuePreview() {
    return (
        <div className="flex flex-col gap-6 p-6 w-full max-w-[920px]">
            <div className="text-xs text-muted font-mono">Files transfer queue strip</div>
            <div className="rounded-md border border-border bg-panel overflow-hidden">
                <TransferQueueStatus queue={makeTransferQueuePreviewState()} />
            </div>
            <div className="rounded-md border border-border bg-panel overflow-hidden max-w-[360px]">
                <TransferQueueStatus queue={makeTransferQueuePreviewState()} maxJobs={3} />
            </div>
        </div>
    );
}
