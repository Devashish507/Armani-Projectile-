"use client";

import { useMemo } from "react";

/* ────────────────────────────────────────────────────────────────
 * OrbitPlane — faint translucent ring showing the orbital plane.
 *
 * Gives spatial context by visualising the plane the satellite
 * orbits within.  Very low opacity so it doesn't overpower the
 * main orbit line.
 * ──────────────────────────────────────────────────────────────── */

interface OrbitPlaneProps {
  /** Orbit radius in world units (Earth radius = 1). */
  orbitRadius?: number;
  /** Orbital inclination in degrees. @default 51.6 */
  inclinationDeg?: number;
  /** Ring colour. @default "#00e5ff" */
  color?: string;
  /** Ring opacity. @default 0.04 */
  opacity?: number;
  /** Whether the plane is visible. @default true */
  visible?: boolean;
}

export default function OrbitPlane({
  orbitRadius = 1.063,
  inclinationDeg = 51.6,
  color = "#00e5ff",
  opacity = 0.04,
  visible = true,
}: OrbitPlaneProps) {
  // Convert inclination to radians — rotate about X axis
  const inclination = useMemo(
    () => (inclinationDeg * Math.PI) / 180,
    [inclinationDeg],
  );

  return (
    <mesh
      rotation={[inclination, 0, 0]}
      visible={visible}
    >
      <ringGeometry args={[orbitRadius * 0.3, orbitRadius * 1.05, 128]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={2} /* DoubleSide */
        depthWrite={false}
      />
    </mesh>
  );
}
