import { useWaveEnv } from "@/app/waveenv/waveenv";
import { summarizeTransferQueue } from "@/util/transferdisplay";
import { createTransferQueue, type TransferQueue } from "@/util/transferqueue";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { PreviewEnv } from "./previewenv";
import "./transfer-queue-status.scss";

const MaxVisibleTransfers = 5;

type TransferQueueStatusProps = {
    queue: TransferQueue;
    bridgeError?: string;
    maxJobs?: number;
};

function DirectoryTransferQueueStatus() {
    const env = useWaveEnv<PreviewEnv>();
    const [queue, setQueue] = useState<TransferQueue>(() => createTransferQueue());
    const [bridgeError, setBridgeError] = useState<string>(null);

    useEffect(() => {
        let disposed = false;

        env.electron
            .getTransferQueue()
            .then((nextQueue) => {
                if (!disposed) {
                    setQueue(nextQueue ?? createTransferQueue());
                    setBridgeError(null);
                }
            })
            .catch((err) => {
                if (!disposed) {
                    setBridgeError(`Transfer status unavailable: ${err}`);
                }
            });

        const cleanup = env.electron.onTransferQueueUpdate((nextQueue) => {
            if (disposed) {
                return;
            }
            setQueue(nextQueue ?? createTransferQueue());
            setBridgeError(null);
        });

        return () => {
            disposed = true;
            cleanup?.();
        };
    }, [env.electron]);

    return <TransferQueueStatus queue={queue} bridgeError={bridgeError} />;
}

function TransferQueueStatus({ queue, bridgeError, maxJobs = MaxVisibleTransfers }: TransferQueueStatusProps) {
    const display = useMemo(() => summarizeTransferQueue(queue, maxJobs), [queue, maxJobs]);

    if (display.totalCount === 0 && !bridgeError) {
        return null;
    }

    return (
        <section className="transfer-queue-status" aria-label="Transfer status" aria-live="polite">
            <div className="transfer-queue-status-head">
                <div className="transfer-queue-status-title">
                    <i className="fa-solid fa-circle-down" aria-hidden="true" />
                    <span>Transfers</span>
                </div>
                <div className="transfer-queue-status-count">
                    {display.activeCount > 0 ? `${display.activeCount} active` : `${display.totalCount} recent`}
                </div>
            </div>
            {bridgeError && (
                <div className="transfer-queue-bridge-error" role="status">
                    <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                    <span>{bridgeError}</span>
                </div>
            )}
            {display.jobs.length > 0 && (
                <div className="transfer-queue-list">
                    {display.jobs.map((job) => (
                        <div className="transfer-queue-row" data-status={job.status} data-tone={job.tone} key={job.id}>
                            <i className={clsx("transfer-queue-row-icon", job.iconClass)} aria-hidden="true" />
                            <div className="transfer-queue-row-main">
                                <div className="transfer-queue-row-topline">
                                    <span className="transfer-queue-row-label">{job.label}</span>
                                    <span className="transfer-queue-row-status">{job.statusLabel}</span>
                                </div>
                                <div className="transfer-queue-row-detail">{job.detail}</div>
                                {job.subdetail && <div className="transfer-queue-row-subdetail">{job.subdetail}</div>}
                                {job.errorText && <div className="transfer-queue-row-error">{job.errorText}</div>}
                            </div>
                        </div>
                    ))}
                    {display.hiddenCount > 0 && (
                        <div className="transfer-queue-more">+{display.hiddenCount} more transfers</div>
                    )}
                </div>
            )}
        </section>
    );
}

export { DirectoryTransferQueueStatus, TransferQueueStatus };
