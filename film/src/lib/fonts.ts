import { continueRender, delayRender, staticFile } from "remotion";

// The terminal face is the app's own (Hack Nerd Mono), so vector close-ups match the capture.
export const MonoFamily = "GenieMono";
export const SansFamily = "GenieSans";

const faces: [string, string, string][] = [
    [MonoFamily, "fonts/hacknerdmono-regular.ttf", "400"],
    [MonoFamily, "fonts/hacknerdmono-bold.ttf", "700"],
    [SansFamily, "fonts/inter-variable.woff2", "100 900"],
];

let loaded = false;

export function loadFonts() {
    if (loaded || typeof document === "undefined") {
        return;
    }
    loaded = true;
    const handle = delayRender("fonts");
    Promise.all(
        faces.map(([family, file, weight]) => {
            const face = new FontFace(family, `url(${staticFile(file)})`, { weight });
            (document.fonts as unknown as Set<FontFace>).add(face);
            return face.load();
        })
    )
        .then(() => continueRender(handle))
        .catch((e) => {
            console.error(e);
            continueRender(handle);
        });
}
