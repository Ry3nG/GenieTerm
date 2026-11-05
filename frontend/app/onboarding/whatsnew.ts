// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import coerce from "semver/functions/coerce";
import lt from "semver/functions/lt";
import parse from "semver/functions/parse";
import type { FeatureItem } from "./onboarding-tour";

type UpgradeRelease = { version: string; items: FeatureItem[] };

export const UpgradeReleases: UpgradeRelease[] = [
    {
        version: "v1.7.1",
        items: [
            {
                icon: "fa-bell",
                title: "See what's new after updating",
                description:
                    "When you open an updated app, its release highlights appear here. Reopen them anytime from the command palette.",
            },
        ],
    },
    {
        version: "v1.7.0",
        items: [
            {
                icon: "fa-terminal",
                title: "Continue in Codex or Claude Code",
                description:
                    "In Command AI, review and copy your context, then open an AI terminal on the same host and in the same folder.",
            },
            {
                icon: "fa-folder-open",
                title: "Download remote folders",
                description:
                    "Download through your existing connection and follow the bytes transferred and files completed in the transfer queue.",
            },
            {
                icon: "fa-server",
                title: "Recover an SSH session",
                description:
                    "Session controls stay responsive during large pastes. After reconnecting, a notice tells you if output was lost.",
            },
        ],
    },
    {
        version: "v1.6.0",
        items: [
            {
                icon: "fa-clock-rotate-left",
                title: "Command history",
                description: "Find earlier commands by host and folder, then insert them at your prompt.",
            },
            {
                icon: "fa-magnifying-glass",
                title: "Search command output",
                description: "Inspect, search and copy a snapshot of one command's output from the terminal menu.",
            },
            {
                icon: "fa-server",
                title: "Remote sessions and saved forwards",
                description:
                    "Find durable SSH sessions in Host and save named port forwards, with optional restoration on connection.",
            },
            {
                icon: "fa-copy",
                title: "Batch file operations",
                description:
                    "Select multiple files and folders to copy or download together, with progress, retry and name-conflict choices.",
            },
        ],
    },
    {
        version: "v1.4.0",
        items: [
            {
                icon: "fa-globe",
                title: "Open remote servers here",
                description:
                    "When TensorBoard, Jupyter or a dev server on an SSH host prints its localhost URL, one click forwards the port and opens it.",
            },
        ],
    },
    {
        version: "v1.3.0",
        items: [
            {
                icon: "fa-compass",
                title: "Quick Start",
                description:
                    "A one-minute tour inside your own terminal: run a command, ask Command AI, open a folder. It moves on when you do.",
            },
            {
                icon: "fa-lightbulb",
                title: "Tips when they help",
                description:
                    "The first time a command fails, GenieTerm points to the fix. Connect to a server and it shows where its files and GPUs are. Once each.",
            },
        ],
    },
    {
        version: "v1.2.0",
        items: [
            {
                icon: "fa-wand-magic-sparkles",
                title: "Command AI, with the AI you already have",
                description:
                    "Describe what you want and get a command to review. It uses your Codex or Claude Code sign-in, or your own API key.",
            },
            {
                icon: "fa-stethoscope",
                title: "Fix and explain",
                description: "The sparkle on a finished command explains it, or says why it failed and how to fix it.",
            },
            {
                icon: "fa-location-crosshairs",
                title: "Knows the machine",
                description: "Commands fit the host's system, distribution and shell, even over SSH.",
            },
            {
                icon: "fa-shield-halved",
                title: "Nothing leaves without you",
                description:
                    "Requests go out only when you ask, with keys and tokens removed. “What’s sent” shows the exact request.",
            },
        ],
    },
    {
        version: "v1.0.0",
        items: [
            {
                icon: "fa-server",
                title: "Host: GPUs, processes and ports",
                description: "One view per machine, from this Mac to a GPU box over SSH. Find it on the widget rail.",
            },
            {
                icon: "fa-arrow-right-to-bracket",
                title: "Port forwarding without ssh -L",
                description: "Forward & open puts Jupyter, TensorBoard or a dev server on localhost in one click.",
            },
            {
                icon: "fa-bell",
                title: "Know when it's done",
                description: "Long commands notify you when they finish while you're looking elsewhere.",
            },
        ],
    },
];

export const CurrentOnboardingVersion = UpgradeReleases[0].version;
export const WhatsNewTitle = "GenieTerm " + CurrentOnboardingVersion.slice(1);

export function isOlderThan(lastVersion: string, version = CurrentOnboardingVersion): boolean {
    const last = parse(lastVersion) ?? coerce(lastVersion);
    return last == null || lt(last, version);
}
