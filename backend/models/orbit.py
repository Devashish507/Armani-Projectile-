"""
Request and response schemas for the orbit simulation API.

These Pydantic models define the contract between the frontend mission-control
dashboard and the orbital propagation engine.  They enforce SI-unit
conventions (metres, m/s, seconds) and surface clear validation errors before
any expensive computation begins.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Request ─────────────────────────────────────────────────────────


class OrbitRequest(BaseModel):
    """Input parameters for a two-body orbit simulation.

    All spatial values must be in **SI units** (metres, m/s, seconds).

    Attributes
    ----------
    initial_position : list[float]
        Cartesian position [x, y, z] in metres (length 3).
    initial_velocity : list[float]
        Cartesian velocity [vx, vy, vz] in m/s (length 3).
    time_span : float
        Total simulation duration in seconds.  Must be > 0.
    time_step : float
        Output sample interval in seconds.  Must be > 0 and ≤ time_span.
    """

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

    # ── Element-count validators ────────────────────────────────────

    @field_validator("initial_position")
    @classmethod
    def position_must_be_3d(cls, v: list[float]) -> list[float]:
        if len(v) != 3:
            raise ValueError(
                f"initial_position must have exactly 3 elements, got {len(v)}"
            )
        return v

    @field_validator("initial_velocity")
    @classmethod
    def velocity_must_be_3d(cls, v: list[float]) -> list[float]:
        if len(v) != 3:
            raise ValueError(
                f"initial_velocity must have exactly 3 elements, got {len(v)}"
            )
        return v

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


class OrbitResponse(BaseModel):
    """Computed trajectory returned by the simulation endpoint.

    Arrays are row-per-epoch: ``position[i]`` is the [x, y, z] at ``time[i]``.

    Attributes
    ----------
    time : list[float]
        Epoch values in seconds from simulation start.
    position : list[list[float]]
        Position vectors [m] at each epoch — shape (N, 3).
    velocity : list[list[float]]
        Velocity vectors [m/s] at each epoch — shape (N, 3).
    metadata : SimulationMetadata
        Solver diagnostics (method, energy drift, evaluations, step count).
    """

    time: list[float] = Field(..., description="Time stamps [s]")
    position: list[list[float]] = Field(
        ..., description="Position vectors [m] — (N, 3)"
    )
    velocity: list[list[float]] = Field(
        ..., description="Velocity vectors [m/s] — (N, 3)"
    )
    metadata: SimulationMetadata
