// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

export type HostSession = {
    id: string;
    blockid: string;
    command: string;
    status: "connected" | "disconnected" | "starting" | "finished";
    detail: string;
    started: number;
    exited: number;
};

export function makeHostSessions(jobs: Job[], connection: string, connectedIds: string[]): HostSession[] {
    const connected = new Set(connectedIds);
    return jobs
        .filter((job) => job.connection === connection)
        .map((job): HostSession => {
            const finished = job.jobmanagerstatus === "done" || job.cmdexitts > 0;
            const status = finished
                ? "finished"
                : connected.has(job.oid)
                  ? "connected"
                  : job.jobmanagerstatus === "init"
                    ? "starting"
                    : "disconnected";
            const detail = finished
                ? job.jobmanagerstartuperror ||
                  job.cmdexiterror ||
                  job.cmdexitsignal ||
                  (job.cmdexitts ? `Exit code ${job.cmdexitcode ?? 0}` : job.jobmanagerdonereason || "Session ended")
                : status === "disconnected"
                  ? "Last known session · remote state unverified"
                  : status === "starting"
                    ? "Session is starting"
                    : "Attached to the durable session";
            return {
                id: job.oid,
                blockid: job.attachedblockid,
                command: job.jobkind === "shell" ? job.cmd || "Shell" : [job.cmd, ...(job.cmdargs ?? [])].join(" "),
                status,
                detail,
                started: job.cmdstartts || job.jobmanagerstartts || 0,
                exited: job.cmdexitts || 0,
            };
        })
        .sort((a, b) => Number(a.status === "finished") - Number(b.status === "finished") || b.started - a.started);
}
