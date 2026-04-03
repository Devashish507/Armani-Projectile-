/**
 * Orbit simulation types — mirrors the backend Pydantic schemas.
 *
 * All backend values are in SI units (metres, m/s, seconds).
 * Use SCALE_FACTOR to convert metres → scene world units where
 * Earth radius = 1 world unit.
 *
 * Protocol v1 Binary Frame Layout:
 *   Position update (52 bytes):
 *     [version:f32, type:f32, seq:f32, time:f64,
 *      px:f32, py:f32, pz:f32, vx:f32, vy:f32, vz:f32,
 *      step:f32, total_steps:f32]
 *
 *   Control frame (12 bytes):
 *     [version:f32, type:f32, payload:f32]
 *
 *   Type markers: 0.0 = position_update, 1.0 = complete, 2.0 = heartbeat
 */

// ── Scale ──────────────────────────────────────────────────────────

/** Earth's mean radius in metres — the conversion denominator. */
export const EARTH_RADIUS_M = 6_371_000;

/**
 * Divide backend positions (metres) by this to get world units.
 * Earth radius = 1 world unit in the scene.
 */
export const SCALE_FACTOR = EARTH_RADIUS_M;

// ── Protocol Constants ─────────────────────────────────────────────

/** Current binary protocol version. */
export const PROTOCOL_VERSION = 1;

/** Size of a position update frame in bytes. */
export const FRAME_SIZE_POSITION = 52;

/** Size of a control frame (complete/heartbeat) in bytes. */
export const FRAME_SIZE_CONTROL = 12;

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

// ── Camera modes ───────────────────────────────────────────────────

/** Camera positioning modes. */
export type CameraMode = "orbit" | "follow" | "free";

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

// ── Connection diagnostics ─────────────────────────────────────────

/** Real-time connection health metrics. */
export interface ConnectionDiagnostics {
  /** EWMA network latency in ms. */
  latencyMs: number;
  /** Rolling packets per second. */
  packetsPerSec: number;
  /** Current interpolation buffer depth. */
  bufferDepth: number;
  /** Cumulative out-of-order/dropped frame count. */
  droppedFrames: number;
  /** Protocol version received from server. */
  protocolVersion: number;
  /** Last 60 latency samples for sparkline rendering. */
  latencyHistory: number[];
}

// ── WebSocket message types ────────────────────────────────────────

/** Single position frame received over the WebSocket (v1 protocol). */
export interface WsPositionUpdate {
  type: "position_update";
  version: number;
  seq: number;
  time: number;
  position: [number, number, number];
  velocity: [number, number, number];
  step: number;
  total_steps: number;
}

/** End-of-stream marker. */
export interface WsSimulationComplete {
  type: "simulation_complete";
  version: number;
  seq: number;
}

/** Server heartbeat ping. */
export interface WsHeartbeat {
  type: "heartbeat";
  version: number;
  serverTime: number;
}

/** Server-side error (JSON). */
export interface WsError {
  type: "error";
  detail: string;
}

/** Discriminated union of all incoming WebSocket messages. */
export type WsOrbitMessage =
  | WsPositionUpdate
  | WsSimulationComplete
  | WsHeartbeat
  | WsError;

/** WebSocket connection lifecycle states. */
export type WsConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "streaming"
  | "complete"
  | "error"
  | "closed";
