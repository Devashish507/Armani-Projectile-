"""
Request and response schemas for the orbit simulation API.

These Pydantic models define the contract between the frontend mission-control
dashboard and the orbital propagation engine.  They enforce SI-unit
conventions (metres, m/s, seconds) and surface clear validation errors before
any expensive computation begins.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Request ─────────────────────────────────────────────────────────

class SatelliteConfig(BaseModel):
    """Configuration for a single satellite."""
    id: str = Field(..., description="Unique string identifier for the satellite")
    initial_position: list[float] = Field(
        ...,
        description="Cartesian position [x, y, z] in metres",
        examples=[[7_000_000.0, 0.0, 0.0]],
    )
    initial_velocity: list[float] = Field(
        ...,
        description="Cartesian velocity [vx, vy, vz] in m/s",
        examples=[[0.0, 7546.0, 0.0]],
    )

    @field_validator("initial_position", "initial_velocity")
    @classmethod
    def vector_must_be_3d(cls, v: list[float], info) -> list[float]:
        if len(v) != 3:
            raise ValueError(f"{info.field_name} must have exactly 3 elements, got {len(v)}")
        return v


class OrbitRequest(BaseModel):
    """Input parameters for a constellation simulation.

    All spatial values must be in **SI units** (metres, m/s, seconds).

    Attributes
    ----------
    satellites : list[SatelliteConfig]
        List of satellite initial conditions.
    time_span : float
        Total simulation duration in seconds.  Must be > 0.
    time_step : float
        Output sample interval in seconds.  Must be > 0 and ≤ time_span.
    max_points : int | None
        Maximum number of trajectory points returned to the client.
        When the raw simulation produces more points than this limit,
        the output is uniformly downsampled.  Essential for 3D rendering
        performance.  Defaults to 500; set to ``None`` to disable.
    include_metadata : bool
        If ``True`` (default), the response includes solver diagnostics
        (method, energy drift, evaluations).  Set to ``False`` to skip
        the metadata envelope when it is not needed.
    """

    satellites: list[SatelliteConfig] = Field(
        ...,
        description="List of satellites to simulate",
    )
    time_span: float = Field(
        ...,
        gt=0,
        description="Total simulation time in seconds",
        examples=[5400],
    )
    time_step: float = Field(
        ...,
        gt=0,
        description="Output time step in seconds",
        examples=[10],
    )
    max_points: Optional[int] = Field(
        default=500,
        gt=0,
        description="Max trajectory points returned (uniform downsample). "
                    "Set to null to disable downsampling.",
        examples=[500],
    )
    include_metadata: bool = Field(
        default=True,
        description="Include solver diagnostics in the response",
    )

    # ── Cross-field validator ───────────────────────────────────────

    @model_validator(mode="after")
    def step_must_not_exceed_span(self) -> OrbitRequest:
        if self.time_step > self.time_span:
            raise ValueError(
                f"time_step ({self.time_step}) cannot exceed "
                f"time_span ({self.time_span})"
            )
        return self


# ── Response ────────────────────────────────────────────────────────


class SimulationMetadata(BaseModel):
    """Diagnostic information about the propagation run."""

    method: str = Field(..., description="ODE integration method used")
    energy_drift_pct: float = Field(
        ..., description="Relative energy drift over the simulation [%]"
    )
    solver_evaluations: int = Field(
        ..., description="Number of RHS function evaluations"
    )
    n_steps: int = Field(..., description="Number of output time steps")


class SatelliteTrajectory(BaseModel):
    """Trajectory for a single satellite."""
    id: str = Field(..., description="Unique string identifier for the satellite")
    time: list[float] = Field(..., description="Time stamps [s]")
    position: list[list[float]] = Field(..., description="Position vectors [m] — (N, 3)")
    velocity: list[list[float]] = Field(..., description="Velocity vectors [m/s] — (N, 3)")


class OrbitResponse(BaseModel):
    """Computed trajectory returned by the simulation endpoint.

    Attributes
    ----------
    simulation_id : str
        Unique identifier for this simulation run (UUID4).
    satellites : list[SatelliteTrajectory]
        Trajectories grouped by satellite.
    metadata : SimulationMetadata | None
        Solver diagnostics.  ``None`` when ``include_metadata=false``.
    """

    simulation_id: str = Field(
        ..., description="Unique simulation run identifier (UUID4)"
    )
    satellites: list[SatelliteTrajectory] = Field(
        ..., description="List of individual satellite trajectories"
    )
    metadata: Optional[SimulationMetadata] = Field(
        default=None,
        description="Solver diagnostics (omitted when include_metadata=false)",
    )


# ── WebSocket Parameters ────────────────────────────────────────────


class WsOrbitParams(BaseModel):
    """Orbit parameters received over the WebSocket channel.

    Mirrors the core fields of :class:`OrbitRequest` without the REST-only
    options.
    """

    satellites: list[SatelliteConfig] = Field(
        ..., description="List of satellites to simulate",
    )
    time_span: float = Field(..., gt=0, description="Total simulation time in seconds")
    time_step: float = Field(..., gt=0, description="Output time step in seconds")
    resume_from_time: Optional[float] = Field(
        default=None,
        ge=0,
        description="Resume streaming from this simulation time (seconds). "
                    "Frames before this timestamp are skipped.",
    )

    @model_validator(mode="after")
    def step_must_not_exceed_span(self) -> WsOrbitParams:
        if self.time_step > self.time_span:
            raise ValueError(
                f"time_step ({self.time_step}) cannot exceed "
                f"time_span ({self.time_span})"
            )
        return self


# ── Transfer Request/Response ───────────────────────────────────────


class TransferRequest(BaseModel):
    """Input parameters for a Hohmann transfer simulation.

    All radii must be in **SI units** (metres).

    Attributes
    ----------
    initial_radius : float
        Radius of the initial circular orbit [m]. Must be > 0.
    target_radius : float
        Radius of the target circular orbit [m]. Must be > 0.
    max_points : int | None
        Maximum number of trajectory points returned to the client.
    """

    initial_radius: float = Field(
        ...,
        gt=0,
        description="Radius of the initial circular orbit [m]",
        examples=[7000000.0],
    )
    target_radius: float = Field(
        ...,
        gt=0,
        description="Radius of the target circular orbit [m]",
        examples=[42164000.0],  # GEO
    )
    max_points: Optional[int] = Field(
        default=500,
        gt=0,
        description="Max trajectory points returned (uniform downsample). "
                    "Set to null to disable downsampling.",
        examples=[500],
    )

    @model_validator(mode="after")
    def radii_must_differ(self) -> TransferRequest:
        if self.initial_radius == self.target_radius:
            raise ValueError("initial_radius and target_radius must be different")
        return self


class TransferResponse(BaseModel):
    """Response from a Hohmann transfer calculation and simulation.

    Returns scalar delta-v magnitudes, transfer time, and the complete
    continuous trajectory spanning the initial orbit, the transfer ellipse,
    and the final orbit.

    Attributes
    ----------
    simulation_id : str
        Unique simulation identifier.
    delta_v1 : float
        Magnitude of the first velocity change [m/s].
    delta_v2 : float
        Magnitude of the second velocity change [m/s].
    total_delta_v : float
        Total delta-v required for the transfer [m/s].
    transfer_time : float
        Duration of the transfer phase [s] (half the ellipse period).
    time : list[float]
        Epoch values [s].
    position : list[list[float]]
        Position vectors [m] — (N, 3).
    velocity : list[list[float]]
        Velocity vectors [m/s] — (N, 3).
    """

    simulation_id: str = Field(..., description="Unique simulation identifier")
    delta_v1: float = Field(..., description="First velocity change [m/s]")
    delta_v2: float = Field(..., description="Second velocity change [m/s]")
    total_delta_v: float = Field(..., description="Total delta-v [m/s]")
    transfer_time: float = Field(..., description="Transfer duration [s]")
    time: list[float] = Field(..., description="Time stamps [s]")
    position: list[list[float]] = Field(..., description="Position vectors [m] — (N, 3)")
    velocity: list[list[float]] = Field(..., description="Velocity vectors [m/s] — (N, 3)")

