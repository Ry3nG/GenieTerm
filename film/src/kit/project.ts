import * as THREE from "three";

// Projects the laptop's screen into the frame so a DOM layer can be laid over it exactly.
// The 3D scene draws the device and its light; the screen's content stays vector, crisp at
// any distance, which lets the camera push straight through the glass into the UI.

export const BASE = { w: 31.2, d: 22.0, h: 1.1 };
export const LID = { w: 31.2, d: 21.6, h: 0.55 };
export const SCREEN = { w: LID.w - 1.6, h: ((LID.w - 1.6) * 9) / 16 };
export const OPEN_DEG = 112;

export type CamPose = { pos: [number, number, number]; look: [number, number, number]; fov: number };

export function lidAngle(lid: number): number {
    return THREE.MathUtils.degToRad(OPEN_DEG * (1 - lid));
}

// World position of a point on the screen plane: u, v in [0,1], (0,0) top-left as seen.
export function screenPoint(lid: number, u: number, v: number): THREE.Vector3 {
    const x = (u - 0.5) * SCREEN.w;
    const y = (0.5 - v) * SCREEN.h;
    // plane local (x, y) → lid local (x, -0.006, y + LID.d/2), then hinge rotation
    const p = new THREE.Vector3(x, -0.006 - 0.0005, y + LID.d / 2);
    p.applyAxisAngle(new THREE.Vector3(1, 0, 0), -lidAngle(lid));
    p.add(new THREE.Vector3(0, BASE.h / 2, -BASE.d / 2 + 0.2));
    return p;
}

export function makeCamera(pose: CamPose, width: number, height: number): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(pose.fov, width / height, 1, 400);
    cam.position.set(...pose.pos);
    cam.lookAt(...pose.look);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return cam;
}

export type Pt = { x: number; y: number };

export function projectScreen(pose: CamPose, lid: number, width: number, height: number): Pt[] {
    const cam = makeCamera(pose, width, height);
    return [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ].map(([u, v]) => {
        const p = screenPoint(lid, u, v).project(cam);
        return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    });
}

// Positive when the quad faces the camera (clockwise in screen space, y down).
export function facing(q: Pt[]): number {
    let a = 0;
    for (let i = 0; i < 4; i++) {
        const p = q[i];
        const n = q[(i + 1) % 4];
        a += p.x * n.y - n.x * p.y;
    }
    return a / 2;
}

// ---------- homography: rect (0,0,w,h) → quad, as a CSS matrix3d ----------

type M3 = number[];

function adj(m: M3): M3 {
    return [
        m[4] * m[8] - m[5] * m[7],
        m[2] * m[7] - m[1] * m[8],
        m[1] * m[5] - m[2] * m[4],
        m[5] * m[6] - m[3] * m[8],
        m[0] * m[8] - m[2] * m[6],
        m[2] * m[3] - m[0] * m[5],
        m[3] * m[7] - m[4] * m[6],
        m[1] * m[6] - m[0] * m[7],
        m[0] * m[4] - m[1] * m[3],
    ];
}

function mulMM(a: M3, b: M3): M3 {
    const c: M3 = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let s = 0;
            for (let k = 0; k < 3; k++) {
                s += a[3 * i + k] * b[3 * k + j];
            }
            c[3 * i + j] = s;
        }
    }
    return c;
}

function mulMV(m: M3, v: number[]): number[] {
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

function basisToPoints(p: Pt[]): M3 {
    const m = [p[0].x, p[1].x, p[2].x, p[0].y, p[1].y, p[2].y, 1, 1, 1];
    const v = mulMV(adj(m), [p[3].x, p[3].y, 1]);
    return mulMM(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

// Corners in order: top-left, top-right, bottom-right, bottom-left.
export function quadMatrix(w: number, h: number, quad: Pt[]): string {
    const src = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
    ];
    // basisToPoints takes TL, TR, BL order for the basis plus the fourth point
    const order = (q: Pt[]) => [q[0], q[1], q[3], q[2]];
    const s = basisToPoints(order(src));
    const d = basisToPoints(order(quad));
    const t = mulMM(d, adj(s));
    const n = t.map((x) => x / t[8]);
    return `matrix3d(${[n[0], n[3], 0, n[6], n[1], n[4], 0, n[7], 0, 0, 1, 0, n[2], n[5], 0, n[8]].join(",")})`;
}

export function lerpQuad(a: Pt[], b: Pt[], t: number): Pt[] {
    return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t }));
}

export function rectQuad(x: number, y: number, w: number, h: number): Pt[] {
    return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
    ];
}

// A camera pose looking straight at the open screen from `dist` cm, used to land the push-in
// on a frame where the screen is an upright rectangle.
export function frontalPose(lid: number, dist: number, fov: number): CamPose {
    const c = screenPoint(lid, 0.5, 0.5);
    const top = screenPoint(lid, 0.5, 0);
    const right = screenPoint(lid, 1, 0.5);
    const up = top.clone().sub(c).normalize();
    const side = right.clone().sub(c).normalize();
    const normal = new THREE.Vector3().crossVectors(side, up).normalize();
    const pos = c.clone().add(normal.multiplyScalar(dist));
    return { pos: [pos.x, pos.y, pos.z], look: [c.x, c.y, c.z], fov };
}

// Distance at which the screen's height fills `frac` of the frame height.
export function distanceForFill(fov: number, frac: number): number {
    return SCREEN.h / frac / 2 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
}

export function lerpPose(a: CamPose, b: CamPose, t: number): CamPose {
    const l = (x: number[], y: number[]) => x.map((v, i) => v + (y[i] - v) * t) as [number, number, number];
    return { pos: l(a.pos, b.pos), look: l(a.look, b.look), fov: a.fov + (b.fov - a.fov) * t };
}
