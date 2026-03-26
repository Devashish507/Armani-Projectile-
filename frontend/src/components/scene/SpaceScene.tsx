"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars, Preload } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import Earth from "./Earth";
import CameraController from "./CameraController";

/* ────────────────────────────────────────────────────────────────
 * SpaceScene — root 3D container for mission-control.
 *
 * Visual upgrades in this version:
 *   • ACES filmic tone mapping for cinematic contrast
 *   • Physically tuned lighting — very low ambient (0.05) plus
 *     a strong directional "sun" for a crisp day/night split
 *   • Camera starts at z=8 (far) for the intro zoom animation
 *   • Stars tuned with factor=4 for depth parallax
 *
 * Extension points:
 *   • Satellite meshes as children inside <Canvas>
 *   • Orbit path lines alongside <Earth>
 * ──────────────────────────────────────────────────────────────── */

export default function SpaceScene() {
  return (
    <Canvas
      /* Camera starts far out — CameraController will lerp it in */
      camera={{
        position: [0, 0, 8],
        fov: 55,
        near: 0.1,
        far: 1000,
      }}
      /* Cap pixel ratio to 2× — retina quality without GPU strain */
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
      }}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    >
      {/* ── Lighting ────────────────────────────────────────── */}
      {/* Very low ambient — lets the dark side stay dark so
          emissive city-lights can shine through.              */}
      <ambientLight intensity={0.05} />
      {/* Strong directional "sun" for a clean day/night split */}
      <directionalLight position={[5, 2, 2]} intensity={2} />

      {/* ── Scene content ───────────────────────────────────── */}
      <Suspense fallback={null}>
        <Earth />
        {/* Star field — tuned for depth parallax */}
        <Stars
          radius={100}
          depth={60}
          count={4000}
          factor={4}
          saturation={0}
          fade
          speed={0.5}
        />
      </Suspense>

      {/* ── Controls + intro animation ──────────────────────── */}
      <CameraController />

      {/* Eagerly preload all drei assets (textures, etc.) */}
      <Preload all />
    </Canvas>
  );
}
