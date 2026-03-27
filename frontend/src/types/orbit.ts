/**
 * Orbit simulation types — mirrors the backend Pydantic schemas.
 *
 * All backend values are in SI units (metres, m/s, seconds).
 * Use SCALE_FACTOR to convert metres → scene world units where
 * Earth radius = 1 world unit.
 */

// ── Scale ──────────────────────────────────────────────────────────

/** Earth's mean radius in metres — the conversion denominator. */
export const EARTH_RADIUS_M = 6_371_000;

/**
 * Divide backend positions (metres) by this to get world units.
 * Earth radius = 1 world unit in the scene.
 */
export const SCALE_FACTOR = EARTH_RADIUS_M;

// ── Request ────────────────────────────────────────────────────────

export interface OrbitSimulationRequest {
  /** Cartesian position [x, y, z] in metres. */
  initial_position: [number, number, number];
  /** Cartesian velocity [vx, vy, vz] in m/s. */
  initial_velocity: [number, number, number];
  /** Total simulation duration in seconds. */
  time_span: number;
  /** Output sample interval in seconds. */
  time_step: number;
  /** Max trajectory points (uniform downsample). `null` = full resolution. */
  max_points?: number | null;
  /** Include solver diagnostics in response. */
  include_metadata?: boolean;
}

// ── Response ───────────────────────────────────────────────────────

export interface SimulationMetadata {
  method: string;
  energy_drift_pct: number;
  solver_evaluations: number;
  n_steps: number;
}

export interface OrbitSimulationResponse {
  simulation_id: string;
  /** Epoch timestamps in seconds from simulation start. */
  time: number[];
  /** Position vectors [m] at each epoch — shape (N, 3). */
  position: [number, number, number][];
  /** Velocity vectors [m/s] at each epoch — shape (N, 3). */
  velocity: [number, number, number][];
  metadata: SimulationMetadata | null;
}

// ── Scaled trajectory (ready for the scene) ────────────────────────

export interface ScaledTrajectory {
  /** Time stamps in seconds. */
  times: number[];
  /** Positions in world units (Earth radius = 1). */
  positions: [number, number, number][];
  /** Velocities in world units/s (optional, for telemetry). */
  velocities?: [number, number, number][];
}

// ── Playback controls ──────────────────────────────────────────────

export interface OrbitPlaybackState {
  /** Whether animation is paused. */
  paused: boolean;
  /** Playback speed multiplier (1× = real-time, 50× = fast). */
  speed: number;
  /** Whether camera follows the satellite. */
  followCamera: boolean;
}

// ── Live telemetry ─────────────────────────────────────────────────

export interface OrbitalParameters {
  /** Altitude above Earth surface in km. */
  altitudeKm: number;
  /** Velocity magnitude in km/s. */
  velocityKmS: number;
  /** Orbital inclination in degrees. */
  inclinationDeg: number;
  /** Orbital period in minutes. */
  periodMin: number;
  /** 0→1 progress through current orbit. */
  progress: number;
}
