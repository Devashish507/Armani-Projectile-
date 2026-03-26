"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars, Preload } from "@react-three/drei";
import Earth from "./Earth";
import CameraController from "./CameraController";

/* ────────────────────────────────────────────────────────────────
 * SpaceScene — the root 3D container for the mission-control UI.
 *
 * Responsibilities:
 *   1. Initialise an R3F <Canvas> that fills its parent container.
 *   2. Set up a perspective camera aimed at the origin.
 *   3. Provide scene-level lighting (ambient + directional "sun").
 *   4. Render the Earth and starfield background.
 *   5. Attach orbit camera controls.
 *
 * Extension points:
 *   • Drop satellite meshes as children inside the <Canvas>.
 *   • Add orbit path lines alongside <Earth>.
 *   • Swap in a more detailed lighting rig when postprocessing
 *     is enabled later.
 *
 * Performance notes:
 *   • <Suspense> boundaries let textures stream without blocking.
 *   • <Preload all /> eagerly fetches assets on mount.
 *   • dpr is capped at 2 to balance quality vs. GPU load.
 *   • gl.antialias is on for smooth sphere edges.
 * ──────────────────────────────────────────────────────────────── */

export default function SpaceScene() {
  return (
    <Canvas
      /* Camera starts pulled back on the Z-axis looking at the origin */
      camera={{
        position: [0, 0, 3.5],
        fov: 50,
        near: 0.1,
        far: 1000,
      }}
      /* Cap pixel ratio to 2× — retina quality without burning the GPU */
      dpr={[1, 2]}
      /* Transparent lets the CSS background show during load */
      gl={{ antialias: true, alpha: true }}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    >
      {/* ── Lighting ────────────────────────────────────────── */}
      {/* Low ambient fill so the dark side isn't pure black */}
      <ambientLight intensity={0.15} />
      {/* Directional "sun" — positioned to the upper-right */}
      <directionalLight position={[5, 3, 5]} intensity={1.8} />

      {/* ── Scene content ───────────────────────────────────── */}
      <Suspense fallback={null}>
        <Earth />
        {/* Star field — renders as points on a large sphere */}
        <Stars
          radius={100}
          depth={60}
          count={4000}
          factor={5}
          saturation={0}
          fade
          speed={0.5}
        />
      </Suspense>

      {/* ── Controls ────────────────────────────────────────── */}
      <CameraController />

      {/* Eagerly preload all drei assets (textures, etc.) */}
      <Preload all />
    </Canvas>
  );
}
