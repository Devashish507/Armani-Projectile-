import type { SatelliteConfig } from "@/types/orbit";

export interface ConstellationParams {
  altitudeKm: number;
  inclinationDeg: number;
  t: number; // Total satellites
  p: number; // Number of planes
  f: number; // Relative spacing parameter
}

const EARTH_RADIUS_M = 6371000;
// Using the backend's exact MU to ensure perfectly circular orbits in the simulator
const MU_EARTH = 6.67430e-11 * 5.972e24; 

/**
 * Procedurally generates Cartesian state vectors for a Walker-Delta constellation.
 * 
 * @param config Consists of altitude, inclination, T (total sats), P (planes), F (phasing)
 * @param prefix Prefix for the generated satellite IDs
 * @returns Array of SatelliteConfig ready for the backend
 */
export function generateWalkerDelta(
  { altitudeKm, inclinationDeg, t, p, f }: ConstellationParams,
  prefix: string = "sat"
): SatelliteConfig[] {
  const satellites: SatelliteConfig[] = [];
  
  if (p === 0 || t % p !== 0) {
    throw new Error("Total satellites (T) must be a multiple of the number of planes (P).");
  }

  const s = t / p; // Satellites per plane
  const iRad = (inclinationDeg * Math.PI) / 180;
  const radius = EARTH_RADIUS_M + altitudeKm * 1000;
  const velocityMag = Math.sqrt(MU_EARTH / radius);

  const cosI = Math.cos(iRad);
  const sinI = Math.sin(iRad);

  for (let plane = 0; plane < p; plane++) {
    // RAAN (Omega)
    const omega = (2 * Math.PI * plane) / p;
    const cosO = Math.cos(omega);
    const sinO = Math.sin(omega);

    for (let satInPlane = 0; satInPlane < s; satInPlane++) {
      // True anomaly / Argument of latitude
      // u = (2pi / S) * satInPlane + (2pi * F / T) * plane
      const u = (2 * Math.PI * satInPlane) / s + (2 * Math.PI * f * plane) / t;
      
      // Position and velocity in Perifocal Frame (e=0)
      const xp = radius * Math.cos(u);
      const yp = radius * Math.sin(u);
      
      const vxp = -velocityMag * Math.sin(u);
      const vyp = velocityMag * Math.cos(u);

      // Transform to Earth-Centered Inertial (ECI) Frame
      const x = xp * cosO - yp * cosI * sinO;
      const y = xp * sinO + yp * cosI * cosO;
      const z = yp * sinI;

      const vx = vxp * cosO - vyp * cosI * sinO;
      const vy = vxp * sinO + vyp * cosI * cosO;
      const vz = vyp * sinI;

      satellites.push({
        id: `${prefix}-${plane + 1}-${satInPlane + 1}`,
        initial_position: [x, y, z],
        initial_velocity: [vx, vy, vz],
        metadata: {
          planeIndex: plane,
          satIndex: satInPlane,
          raan: omega,
          inclination: iRad,
          radius: radius / EARTH_RADIUS_M, // Scaled to world units
        }
      });
    }
  }

  return satellites;
}
