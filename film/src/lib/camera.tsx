import React from "react";
import { AbsoluteFill } from "remotion";
import { HEIGHT, WIDTH } from "../timeline";
import { Ease, mix } from "./motion";

// World units are the app window's CSS pixels. At zoom 1 the window is 1680 px wide in the
// 1920 frame, leaving a calm margin of backdrop around it.
export const WINDOW_W = 1600;
export const WINDOW_H = 900;
export const BASE_SCALE = 1680 / WINDOW_W;

export type CamKey = {
    f: number;
    // focus point in world units, kept at the center of the frame
    x: number;
    y: number;
    z: number;
    rx?: number;
    ry?: number;
    rz?: number;
    // easing of the segment that ends at this key
    ease?: (t: number) => number;
};

export type Cam = { x: number; y: number; z: number; rx: number; ry: number; rz: number };

export const Home: Omit<CamKey, "f"> = { x: WINDOW_W / 2, y: WINDOW_H / 2, z: 1 };

export function cameraAt(keys: CamKey[], frame: number): Cam {
    const norm = (k: CamKey): Cam => ({ x: k.x, y: k.y, z: k.z, rx: k.rx ?? 0, ry: k.ry ?? 0, rz: k.rz ?? 0 });
    if (frame <= keys[0].f) {
        return norm(keys[0]);
    }
    for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i];
        const b = keys[i + 1];
        if (frame >= b.f) {
            continue;
        }
        const t = (b.ease ?? Ease.move)((frame - a.f) / (b.f - a.f));
        const A = norm(a);
        const B = norm(b);
        // zoom is perceived logarithmically; interpolating log(z) keeps the speed even
        const z = Math.exp(mix(Math.log(A.z), Math.log(B.z), t));
        return {
            x: mix(A.x, B.x, t),
            y: mix(A.y, B.y, t),
            z,
            rx: mix(A.rx, B.rx, t),
            ry: mix(A.ry, B.ry, t),
            rz: mix(A.rz, B.rz, t),
        };
    }
    return norm(keys[keys.length - 1]);
}

// Screen-space speed of the camera, in frame widths per second, used to gate motion blur.
export function cameraSpeed(keys: CamKey[], frame: number, fps: number): number {
    const a = cameraAt(keys, frame - 0.5);
    const b = cameraAt(keys, frame + 0.5);
    const s = BASE_SCALE * b.z;
    const dx = (b.x - a.x) * s;
    const dy = (b.y - a.y) * s;
    const dz = Math.abs(Math.log(b.z / a.z)) * WIDTH;
    return (Math.hypot(dx, dy) + dz) * fps / WIDTH;
}

export const Stage: React.FC<{ cam: Cam; children: React.ReactNode; perspective?: number }> = ({
    cam,
    children,
    perspective = 2600,
}) => {
    const s = BASE_SCALE * cam.z;
    return (
        <AbsoluteFill style={{ perspective, perspectiveOrigin: "50% 50%" }}>
            <div
                style={{
                    position: "absolute",
                    left: WIDTH / 2,
                    top: HEIGHT / 2,
                    width: 0,
                    height: 0,
                    transformStyle: "preserve-3d",
                    transform: `rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) rotateZ(${cam.rz}deg) scale(${s}) translate(${-cam.x}px, ${-cam.y}px)`,
                    transformOrigin: "0 0",
                }}
            >
                {children}
            </div>
        </AbsoluteFill>
    );
};
