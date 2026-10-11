import { useThree } from "@react-three/fiber";
import React, { useEffect, useMemo, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LID, SCREEN, lidAngle } from "./project";

// The Blender-built laptop (film/blender/laptop.py → public/models/laptop.glb). It honours the
// same contract as the procedural model: `Lid` pivots on the hinge, `Screen` is the glass, and
// `ScreenMat` is driven here so the display can sleep and wake.

function useGLB(file: string) {
    const [gltf, setGltf] = useState<THREE.Group | null>(null);
    const [handle] = useState(() => delayRender(`model ${file}`));
    const advance = useThree((st) => st.advance);
    useEffect(() => {
        new GLTFLoader().load(
            staticFile(file),
            (g) => setGltf(g.scene),
            undefined,
            (e) => {
                console.error(e);
                continueRender(handle);
            }
        );
    }, [file, handle]);
    useEffect(() => {
        if (!gltf) return;
        requestAnimationFrame(() => {
            advance(performance.now());
            continueRender(handle);
        });
    }, [gltf, advance, handle]);
    return gltf;
}

export const LaptopGLB: React.FC<{ lid: number; glow: number; screenColor: string }> = ({ lid, glow, screenColor }) => {
    const scene = useGLB("models/laptop.glb");
    const parts = useMemo(() => {
        if (!scene) return null;
        const lidNode = scene.getObjectByName("Lid");
        const screen = scene.getObjectByName("Screen") as THREE.Mesh | undefined;
        let screenMat: THREE.MeshStandardMaterial | null = null;
        scene.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (m && m.name === "ScreenMat") {
                screenMat = m;
            }
        });
        // the display glows from its own light, not the room's
        if (screen) {
            const basic = new THREE.MeshBasicMaterial({ color: "#000000", toneMapped: false });
            screen.material = basic;
            screenMat = basic as unknown as THREE.MeshStandardMaterial;
        }
        const light = new THREE.RectAreaLight("#cfdcff", 0, SCREEN.w, SCREEN.h);
        light.position.set(0, -0.3, LID.d / 2);
        light.rotation.set(Math.PI / 2, 0, 0);
        lidNode?.add(light);
        return { lidNode, screenMat, light };
    }, [scene]);
    if (!scene || !parts) {
        return null;
    }
    if (parts.lidNode) {
        parts.lidNode.rotation.x = -lidAngle(lid);
    }
    if (parts.screenMat) {
        parts.screenMat.color = new THREE.Color(screenColor).multiplyScalar(glow);
    }
    parts.light.intensity = glow * (2.2 + 4 * Math.pow(lid, 3));
    return <primitive object={scene} />;
};
