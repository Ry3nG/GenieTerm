import React from "react";

// Hand-drawn equivalents of the Font Awesome glyphs the app uses, as strokes so they stay
// crisp at any camera distance.
type P = { size?: number; color?: string; style?: React.CSSProperties };

const Svg: React.FC<P & { children: React.ReactNode; vb?: number }> = ({ size = 16, color = "currentColor", style, children, vb = 24 }) => (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} style={{ display: "block", color, flexShrink: 0, ...style }}>
        {children}
    </svg>
);

const st = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconTerminal: React.FC<P> = (p) => (
    <Svg {...p}>
        <rect x="2.5" y="3.5" width="19" height="17" rx="3.5" fill="currentColor" />
        <path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5" stroke="#1d1d1f" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
);

export const IconFolder: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M2.5 6.5a2 2 0 0 1 2-2h4.6l2.2 2.4h8.2a2 2 0 0 1 2 2v9.6a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2z" fill="currentColor" />
    </Svg>
);

export const IconServer: React.FC<P> = (p) => (
    <Svg {...p}>
        <rect x="2.5" y="3.5" width="19" height="7.5" rx="2" fill="currentColor" />
        <rect x="2.5" y="13" width="19" height="7.5" rx="2" fill="currentColor" />
        <circle cx="17.5" cy="7.25" r="1.2" fill="#1d1d1f" />
        <circle cx="17.5" cy="16.75" r="1.2" fill="#1d1d1f" />
    </Svg>
);

export const IconGear: React.FC<P> = (p) => (
    <Svg {...p}>
        <path
            d="M12 2.8l1.6 2.3 2.7-.7.6 2.7 2.6 1-.9 2.6 1.9 2-1.9 2 .9 2.6-2.6 1-.6 2.7-2.7-.7L12 21.2l-1.6-2.3-2.7.7-.6-2.7-2.6-1 .9-2.6-1.9-2 1.9-2-.9-2.6 2.6-1 .6-2.7 2.7.7z"
            fill="currentColor"
        />
        <circle cx="12" cy="12" r="3.2" fill="#1d1d1f" />
    </Svg>
);

export const IconArrows: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" {...st} />
    </Svg>
);

export const IconShield: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M12 2.5l8 3v6.2c0 5-3.4 8.6-8 9.8-4.6-1.2-8-4.8-8-9.8V5.5z" fill="currentColor" />
    </Svg>
);

export const IconSparkle: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M5 19L15.5 8.5" {...st} />
        <path d="M17 2.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9zM20 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6zM9.5 2.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" />
    </Svg>
);

export const IconX: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M6 6l12 12M18 6L6 18" {...st} />
    </Svg>
);

export const IconPlus: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M12 5v14M5 12h14" {...st} />
    </Svg>
);

export const IconExpand: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" {...st} />
    </Svg>
);

export const IconCheck: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M5 12.5l4.5 4.5L19 7.5" {...st} strokeWidth={2.4} />
    </Svg>
);

export const IconCircleCheck: React.FC<P> = (p) => (
    <Svg {...p}>
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#111" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
);

export const IconCircleX: React.FC<P> = (p) => (
    <Svg {...p}>
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" stroke="#111" strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
);

export const IconWarn: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M12 3l10 17.5H2z" fill="currentColor" strokeLinejoin="round" />
        <path d="M12 9.5v5" stroke="#111" strokeWidth={2.2} strokeLinecap="round" />
        <circle cx="12" cy="17.6" r="1.25" fill="#111" />
    </Svg>
);

export const IconArrowUp: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M12 19V5M6 11l6-6 6 6" {...st} strokeWidth={2.4} />
    </Svg>
);

export const IconFile: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M6 2.5h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="currentColor" />
        <path d="M14 2.5v5h5" fill="none" stroke="#1d1d1f" strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
);

export const IconChevron: React.FC<P & { dir?: "left" | "right" | "down" | "up" }> = ({ dir = "right", ...p }) => {
    const r = { right: 0, down: 90, left: 180, up: 270 }[dir];
    return (
        <Svg {...p}>
            <path d="M9 5l7 7-7 7" {...st} transform={`rotate(${r} 12 12)`} />
        </Svg>
    );
};

export const IconLink: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" {...st} />
    </Svg>
);

export const IconMoon: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />
    </Svg>
);

export const IconCopy: React.FC<P> = (p) => (
    <Svg {...p}>
        <rect x="8" y="8" width="12" height="12" rx="2" {...st} />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...st} />
    </Svg>
);

export const IconUpload: React.FC<P> = (p) => (
    <Svg {...p}>
        <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" {...st} />
    </Svg>
);

export const IconSpinner: React.FC<P & { t: number }> = ({ t, ...p }) => (
    <Svg {...p}>
        {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const head = (Math.floor(t / 6) % 8 + 8) % 8;
            const age = (head - i + 8) % 8;
            return <circle key={i} cx={12 + Math.cos(a) * 7.5} cy={12 + Math.sin(a) * 7.5} r={1.6} fill="currentColor" opacity={1 - age * 0.11} />;
        })}
    </Svg>
);
