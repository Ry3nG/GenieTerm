// GenieTerm's own design tokens (frontend/tailwindsetup.css), plus terminal colors sampled
// from 4x captures of the app, so the film's rebuilt UI matches the product exactly.
export const T = {
    bg: "#1d1d1f",
    term: "#0e0e0f",
    tabbar: "#131314",
    rail: "#1d1d1f",
    panel: "#1e1e20",
    modal: "#272729",
    fg: "#f5f5f7",
    secondary: "#c7c7cc",
    muted: "#8e8e93",
    accent: "#2997ff",
    accentHover: "#5aafff",
    error: "rgb(229, 77, 46)",
    warning: "rgb(224, 185, 86)",
    success: "rgb(78, 154, 6)",
    border: "rgba(255,255,255,0.1)",
    hover: "rgba(255,255,255,0.06)",
    radius: 8,
    // terminal palette (xterm, as configured in the app)
    termFg: "#d0d0d0",
    termDim: "#8a8a8a",
    promptUser: "#87d787",
    promptPath: "#5fafff",
    red: "#e05a4f",
    yellow: "#e0b956",
    green: "#87d787",
    cyan: "#6fc3d4",
} as const;

// Hack is the app's terminal face; Inter stands in for the system UI font on film.
export const MONO_SIZE = 13;
export const CELL_W = 7.8265;
export const CELL_H = 15;
