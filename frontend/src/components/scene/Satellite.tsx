"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

/* ────────────────────────────────────────────────────────────────
 * Satellite — realistic spacecraft with solar panel wings.
 *
 * Upgrades:
 *   • Solar panel cross — two thin box wings extending from body
 *   • Earth-shadow occlusion — dims when behind Earth relative
 *     to camera for depth perception
 *   • Directional shading — panels catch sunlight
 *   • Gentle tumble animation
 * ──────────────────────────────────────────────────────────────── */

interface SatelliteProps {
  /** Current world-space position [x, y, z]. */
  position: [number, number, number];
  /** Overall scale multiplier. @default 0.03 */
  size?: number;
  /** Body colour. @default "#d0d0d0" */
  color?: string;
  /** Emissive glow colour. @default "#ffd54f" (warm yellow) */
  emissiveColor?: string;
  /** Solar panel colour. @default "#1a237e" (dark blue) */
  panelColor?: string;
  /** Whether the satellite is visible. @default true */
  visible?: boolean;
  /** Optional text label overlay. */
  label?: string;
}

export default function Satellite({
  position,
  size = 0.03,
  color = "#d0d0d0",
  emissiveColor = "#ffd54f",
  panelColor = "#1a237e",
  visible = true,
  label,
}: SatelliteProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const panelMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const { camera } = useThree();

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    // ── Gentle tumble rotation ─────────────────────────────
    groupRef.current.rotation.y += delta * 1.2;
    groupRef.current.rotation.x += delta * 0.4;

    // ── Earth-shadow occlusion ─────────────────────────────
    // When the satellite is behind Earth relative to camera,
    // dim its emissive and light for depth perception.
    const camDir = new THREE.Vector3()
      .copy(camera.position)
      .normalize();
    const satDir = new THREE.Vector3(
      position[0],
      position[1],
      position[2],
    ).normalize();

    const dot = camDir.dot(satDir);
    // dot < 0 means satellite is on the far side from camera
    // dot < -0.2 means clearly behind Earth
    let shadowFactor = 1.0;
    if (dot < 0.0) {
      // Check if satellite is close enough to Earth to be occluded
      const distFromCenter = Math.sqrt(
        position[0] ** 2 + position[1] ** 2 + position[2] ** 2,
      );
      // Only shadow when close to Earth's surface (within ~1.5 Earth radii)
      if (distFromCenter < 1.8) {
        shadowFactor = THREE.MathUtils.clamp(
          THREE.MathUtils.mapLinear(dot, 0.0, -0.5, 1.0, 0.15),
          0.15,
          1.0,
        );
      }
    }

    // Apply shadow factor to materials
    if (bodyMatRef.current) {
      bodyMatRef.current.emissiveIntensity = 1.2 * shadowFactor;
      bodyMatRef.current.opacity = 0.3 + 0.7 * shadowFactor;
    }
    if (panelMatRef.current) {
      panelMatRef.current.emissiveIntensity = 0.3 * shadowFactor;
    }
    if (lightRef.current) {
      lightRef.current.intensity = 0.5 * shadowFactor;
    }
  });

  // Panel dimensions relative to body size
  const panelWidth = size * 4;
  const panelHeight = size * 1.5;
  const panelDepth = size * 0.08;

  return (
    <group position={position} visible={visible}>
      {label && (
        <Html
          position={[0, size * 3, 0]}
          center
          distanceFactor={10}
          zIndexRange={[100, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div className="px-1 py-0.5 rounded bg-black/70 border border-cyan-500/20 text-white shadow-lg text-[4px] font-mono tracking-wider whitespace-nowrap uppercase">
            {label}
          </div>
        </Html>
      )}
      <group ref={groupRef}>
        {/* ── Satellite body (central sphere) ───────────── */}
        <mesh>
          <sphereGeometry args={[size, 16, 16]} />
          <meshStandardMaterial
            ref={bodyMatRef}
            color={color}
            emissive={emissiveColor}
            emissiveIntensity={1.2}
            metalness={0.6}
            roughness={0.2}
            transparent
          />
        </mesh>

        {/* ── Solar panel — port wing ────────────────────── */}
        <mesh position={[-(panelWidth / 2 + size), 0, 0]}>
          <boxGeometry args={[panelWidth, panelHeight, panelDepth]} />
          <meshStandardMaterial
            ref={panelMatRef}
            color={panelColor}
            emissive="#1565c0"
            emissiveIntensity={0.3}
            metalness={0.8}
            roughness={0.15}
          />
        </mesh>

        {/* ── Solar panel — starboard wing ───────────────── */}
        <mesh position={[panelWidth / 2 + size, 0, 0]}>
          <boxGeometry args={[panelWidth, panelHeight, panelDepth]} />
          <meshStandardMaterial
            color={panelColor}
            emissive="#1565c0"
            emissiveIntensity={0.3}
            metalness={0.8}
            roughness={0.15}
          />
        </mesh>

        {/* ── Antenna stub ───────────────────────────────── */}
        <mesh position={[0, size * 1.5, 0]}>
          <cylinderGeometry args={[size * 0.08, size * 0.08, size * 2, 8]} />
          <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>

      {/* ── Point light — illuminates nearby geometry ──── */}
      <pointLight
        ref={lightRef}
        color={emissiveColor}
        intensity={0.5}
        distance={2}
        decay={2}
      />
    </group>
  );
}
