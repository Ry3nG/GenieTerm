import { Ai } from "../v3/Ai";
import { H, HostPorts } from "../v3/HostPorts";
import { AgentAway, G } from "./AgentAway";
import { F, FilesShort } from "./FilesShort";
import type { ShortSpec } from "./ShortFilm";

// The series. Demo lengths are whole bars of the 90 BPM grid (160 frames) where possible.
export const Shorts: ShortSpec[] = [
    { id: "ShortAgent", hook: "Close the lid. Your agent keeps working.", feature: "Durable sessions", demo: AgentAway, demoLength: G.end, audio: "short_agent.wav", cold: "agent" },
    { id: "ShortAI", hook: "Stuck? Ask the AI you already use.", feature: "Command AI", demo: Ai, demoLength: 1440, audio: "short_ai.wav" },
    { id: "ShortFiles", hook: "The server's files, right here.", feature: "Remote files", demo: FilesShort, demoLength: F.end, audio: "short_files.wav" },
    { id: "ShortHost", hook: "See the whole machine.", feature: "Host and ports", demo: HostPorts, demoLength: H.end, audio: "short_host.wav" },
];
