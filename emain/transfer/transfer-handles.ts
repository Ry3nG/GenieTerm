const cancelHandles = new Map<string, () => void>();

export function registerTransferCancelHandle(jobId: string, cancel: () => void) {
    cancelHandles.set(jobId, cancel);
}

export function clearTransferCancelHandle(jobId: string) {
    cancelHandles.delete(jobId);
}

export function invokeTransferCancelHandle(jobId: string): boolean {
    const cancel = cancelHandles.get(jobId);
    if (cancel == null) {
        return false;
    }
    cancelHandles.delete(jobId);
    cancel();
    return true;
}
