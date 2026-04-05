/**
 * telemetry.ts — Pure helper functions for real-time telemetry calculations.
 *
 * All functions are pure (no side effects) and designed for memoization.
 * Units convention:
 *   • Backend sends positions in metres, velocities in m/s
 *   • Display values are in km and km/s
 *   • Earth radius: 6,371 km (IAU mean radius)
 */

// ── Constants ──────────────────────────────────────────────────────

/** Earth's mean radius in kilometres (IAU). */
export const EARTH_RADIUS_KM = 6_371;

/** Metres → Kilometres conversion factor. */
const M_TO_KM = 1 / 1_000;

/** m/s → km/s conversion factor. */
const MS_TO_KMS = 1 / 1_000;

// ── Types ──────────────────────────────────────────────────────────

/** Raw telemetry frame as received from the WebSocket. */
export interface RawTelemetryFrame {
  /** Simulation time in seconds. */
  time: number;
  /** Cartesian position [x, y, z] in metres. */
  position: [number, number, number];
  /** Cartesian velocity [vx, vy, vz] in m/s. */
  velocity: [number, number, number];
}

/** Processed telemetry ready for display. */
export interface ProcessedTelemetry {
  /** Mission elapsed time in seconds. */
  missionTime: number;
  /** Position components in km. */
  position: {
    x: number;
    y: number;
    z: number;
  };
  /** Velocity magnitude in km/s: √(vx² + vy² + vz²). */
  velocityMagnitude: number;
  /** Individual velocity components in km/s (for future detail views). */
  velocityComponents: {
    vx: number;
    vy: number;
    vz: number;
  };
  /** Distance from Earth centre in km: √(x² + y² + z²). */
  orbitalRadius: number;
  /** Altitude above Earth surface in km: radius − EARTH_RADIUS_KM. */
  altitude: number;
}

// ── Conversion Functions ───────────────────────────────────────────

/**
 * Convert a position vector from metres to kilometres.
 */
export function positionToKm(
  position: [number, number, number],
): { x: number; y: number; z: number } {
  return {
    x: position[0] * M_TO_KM,
    y: position[1] * M_TO_KM,
    z: position[2] * M_TO_KM,
  };
}

/**
 * Convert a velocity vector from m/s to km/s.
 */
export function velocityToKms(
  velocity: [number, number, number],
): { vx: number; vy: number; vz: number } {
  return {
    vx: velocity[0] * MS_TO_KMS,
    vy: velocity[1] * MS_TO_KMS,
    vz: velocity[2] * MS_TO_KMS,
  };
}

/**
 * Compute the Euclidean magnitude of a 3D vector.
 * Used for both velocity magnitude and orbital radius.
 *
 * mag = √(a² + b² + c²)
 */
export function vectorMagnitude(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Compute altitude above Earth's surface.
 *
 * altitude = |position| − R_earth
 *
 * @param positionM Position vector in metres.
 * @returns Altitude in kilometres.
 */
export function computeAltitudeKm(positionM: [number, number, number]): number {
  const radiusKm = vectorMagnitude(positionM) * M_TO_KM;
  return radiusKm - EARTH_RADIUS_KM;
}

// ── Main Processing Function ───────────────────────────────────────

/**
 * Transform a raw WebSocket frame into display-ready telemetry.
 *
 * This is the single entry point for all derived calculations.
 * It is pure and safe to memoize.
 */
export function processFrame(frame: RawTelemetryFrame): ProcessedTelemetry {
  const posKm = positionToKm(frame.position);
  const velKms = velocityToKms(frame.velocity);

  // Orbital radius: distance from Earth centre (km)
  const orbitalRadius = vectorMagnitude(frame.position) * M_TO_KM;

  // Velocity magnitude (km/s)
  const velocityMagnitude = vectorMagnitude(frame.velocity) * MS_TO_KMS;

  // Altitude above surface (km)
  const altitude = orbitalRadius - EARTH_RADIUS_KM;

  return {
    missionTime: frame.time,
    position: posKm,
    velocityMagnitude,
    velocityComponents: velKms,
    orbitalRadius,
    altitude,
  };
}

// ── Formatting Utilities ───────────────────────────────────────────

/**
 * Format a number with fixed decimal places and thousands separators.
 */
export function formatValue(value: number, decimals: number = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format mission elapsed time as HH:MM:SS.
 */
export function formatMissionTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [
    h.toString().padStart(2, "0"),
    m.toString().padStart(2, "0"),
    s.toString().padStart(2, "0"),
  ].join(":");
}

/**
 * Format mission elapsed time as T+HH:MM:SS (mission control convention).
 */
export function formatMET(seconds: number): string {
  return `T+${formatMissionTime(seconds)}`;
}
