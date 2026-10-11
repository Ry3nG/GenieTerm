import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import React, { useEffect, useMemo, useState } from "react";
import { continueRender, delayRender } from "remotion";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { LaptopGLB } from "./LaptopGLB";
import { BASE, type CamPose, LID, SCREEN, lidAngle } from "./project";

// A procedural, brand-free laptop lit by an image-based environment so its metal reads as
// metal. Units are centimetres; the lid pivots on the base's back edge. The screen itself is
// a plain emissive panel: its content is a DOM layer composited on top (see LaptopShot).

RectAreaLightUniformsLib.init();

// Swap in the Blender model once public/models/laptop.glb exists and passes review.
export const UseModel = true;

// While rendering, ThreeCanvas runs R3F with frameloop "never" and only draws when the frame
// changes, so anything that arrives asynchronously must advance() a draw itself and hold the
// frame until it has happened (invalidate() is a no-op in that mode).
const Environment: React.FC<{ intensity: number }> = ({ intensity }) => {
    const { gl, scene, advance } = useThree();
    const [handle] = useState(() => delayRender("environment"));
    useEffect(() => {
        const pmrem = new THREE.PMREMGenerator(gl);
        const env = pmrem.fromScene(new RoomEnvironment(), 0.02).texture;
        scene.environment = env;
        advance(performance.now());
        continueRender(handle);
        return () => env.dispose();
    }, [gl, scene, advance, handle]);
    scene.environmentIntensity = intensity;
    return null;
};

const Keys: React.FC = () => {
    const keys = useMemo(() => {
        const out: { x: number; z: number; w: number }[] = [];
        const pitch = 1.86;
        for (let r = 0; r < 5; r++) {
            for (let i = 0; i < 13; i++) {
                out.push({ x: -6 * pitch + i * pitch, z: -8.2 + r * pitch, w: 1.55 });
            }
        }
        // bottom row: modifiers, a long space bar, arrows
        const bottom = [1.55, 1.55, 1.55, 1.9, 9.2, 1.9, 1.55, 1.55, 1.55];
        const total = bottom.reduce((a, b) => a + b, 0) + (bottom.length - 1) * 0.31;
        let x = -total / 2;
        for (const w of bottom) {
            out.push({ x: x + w / 2, z: -8.2 + 5 * pitch, w });
            x += w + 0.31;
        }
        return out;
    }, []);
    return (
        <group position={[0, BASE.h / 2 - 0.1, 0]}>
            {keys.map((k, i) => (
                <mesh key={i} position={[k.x, 0.05, k.z]}>
                    <boxGeometry args={[k.w, 0.12, 1.5]} />
                    <meshStandardMaterial color="#060606" roughness={0.8} metalness={0} envMapIntensity={0.25} />
                </mesh>
            ))}
        </group>
    );
};

export const LaptopModel: React.FC<{ lid: number; glow: number; screenColor: string }> = ({ lid, glow, screenColor }) => {
    const baseGeo = useMemo(() => new RoundedBoxGeometry(BASE.w, BASE.h, BASE.d, 6, 0.2), []);
    const lidGeo = useMemo(() => new RoundedBoxGeometry(LID.w, LID.h, LID.d, 6, 0.12), []);
    const metal = useMemo(
        () => new THREE.MeshPhysicalMaterial({ color: "#9a9ea6", metalness: 1, roughness: 0.38, clearcoat: 0.25, clearcoatRoughness: 0.35 }),
        []
    );
    const angle = lidAngle(lid);
    const c = new THREE.Color(screenColor).multiplyScalar(glow);
    return (
        <group>
            <mesh geometry={baseGeo} material={metal} />
            <mesh position={[0, BASE.h / 2 + 0.005, -1.2]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[26.5, 11.8]} />
                <meshStandardMaterial color="#121214" roughness={0.9} envMapIntensity={0.3} />
            </mesh>
            <Keys />
            <mesh position={[0, BASE.h / 2 + 0.006, 7.2]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[12, 6.8]} />
                <meshPhysicalMaterial color="#868a91" roughness={0.42} metalness={0.9} clearcoat={0.6} clearcoatRoughness={0.2} />
            </mesh>
            <group position={[0, BASE.h / 2, -BASE.d / 2 + 0.2]} rotation={[-angle, 0, 0]}>
                <group position={[0, LID.h / 2, LID.d / 2 - 0.2]}>
                    <mesh geometry={lidGeo} material={metal} />
                    <mesh position={[0, -LID.h / 2 - 0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
                        <planeGeometry args={[LID.w - 0.5, LID.d - 0.5]} />
                        <meshPhysicalMaterial color="#050506" roughness={0.45} clearcoat={0.5} clearcoatRoughness={0.25} envMapIntensity={0.18} />
                    </mesh>
                    <mesh position={[0, -LID.h / 2 - 0.006, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
                        <planeGeometry args={[SCREEN.w, SCREEN.h]} />
                        <meshBasicMaterial color={c} toneMapped={false} />
                    </mesh>
                    {/* the display lights the keyboard deck, most strongly just before the lid meets it */}
                    <rectAreaLight
                        position={[0, -LID.h / 2 - 0.3, 0.2]}
                        rotation={[Math.PI / 2, 0, 0]}
                        width={SCREEN.w}
                        height={SCREEN.h}
                        intensity={glow * (2.2 + 4 * Math.pow(lid, 3))}
                        color="#cfdcff"
                    />
                </group>
            </group>
        </group>
    );
};

// A soft occlusion pad under the base; a real shadow map would need a floor we never see.
const ContactShadow: React.FC<{ strength: number }> = ({ strength }) => {
    const tex = useMemo(() => {
        const cv = document.createElement("canvas");
        cv.width = 256;
        cv.height = 256;
        const g = cv.getContext("2d")!;
        const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
        grad.addColorStop(0, "rgba(0,0,0,0.9)");
        grad.addColorStop(0.5, "rgba(0,0,0,0.5)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(cv);
    }, []);
    return (
        <mesh position={[0, -BASE.h / 2 - 0.02, 0.6]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
            <planeGeometry args={[44, 30]} />
            <meshBasicMaterial map={tex} transparent opacity={strength} depthWrite={false} toneMapped={false} />
        </mesh>
    );
};

const CameraRig: React.FC<{ pose: CamPose }> = ({ pose }) => {
    const { camera } = useThree();
    const c = camera as THREE.PerspectiveCamera;
    c.position.set(...pose.pos);
    c.fov = pose.fov;
    c.near = 1;
    c.far = 400;
    c.updateProjectionMatrix();
    c.lookAt(...pose.look);
    return null;
};

export const LaptopScene: React.FC<{
    lid: number;
    glow: number;
    pose: CamPose;
    width: number;
    height: number;
    // 1 = studio lit, 0 = night; the key light and reflections fade, the cool fill remains
    room?: number;
    screenColor?: string;
}> = ({ lid, glow, pose, width, height, room = 1, screenColor = "#0f0f10" }) => (
    <ThreeCanvas
        width={width}
        height={height}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.82, outputColorSpace: THREE.SRGBColorSpace }}
        camera={{ position: pose.pos, fov: pose.fov, near: 1, far: 400 }}
    >
        <Environment intensity={0.2 + 0.85 * room} />
        <CameraRig pose={pose} />
        <spotLight position={[-30, 55, 30]} angle={0.45} penumbra={1} decay={0} intensity={3.2 * room} color="#fff4e8" />
        <directionalLight position={[30, 18, -30]} intensity={0.5 + 0.5 * room} color="#9ab8ff" />
        {UseModel ? <LaptopGLB lid={lid} glow={glow} screenColor={screenColor} /> : <LaptopModel lid={lid} glow={glow} screenColor={screenColor} />}
        <ContactShadow strength={0.55 + 0.25 * lid} />
    </ThreeCanvas>
);
