"""
Orbit simulation router — ``/api/v1/orbit``.

Exposes the two-body propagation engine to the frontend mission-control
dashboard.  The router is intentionally thin: it validates the request
via Pydantic, delegates computation to the service layer, and serialises
the response.

CPU-bound propagation is run via ``asyncio.to_thread`` so the FastAPI event
loop stays responsive for concurrent requests.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

import numpy as np
from fastapi import APIRouter, HTTPException

from models.orbit import OrbitRequest, OrbitResponse, SimulationMetadata
from services.orbit.propagator import propagate_orbit

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/orbit",
    tags=["Orbit"],
)


def _downsample(
    time: np.ndarray,
    position: np.ndarray,
    velocity: np.ndarray,
    max_points: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Uniformly downsample trajectory arrays to at most *max_points*.

    Selects evenly-spaced indices so the overall trajectory shape is
    preserved — critical for accurate 3D rendering on the frontend.
    The first and last points are always included.
    """
    n = len(time)
    if n <= max_points:
        return time, position, velocity

    indices = np.round(np.linspace(0, n - 1, max_points)).astype(int)
    return time[indices], position[indices], velocity[indices]


@router.post(
    "/simulate",
    response_model=OrbitResponse,
    summary="Simulate two-body orbit propagation",
    response_description="Computed trajectory with time, position, and velocity arrays",
)
async def simulate_orbit(request: OrbitRequest) -> OrbitResponse:
    """Run a two-body orbit simulation from the supplied initial conditions.

    The endpoint accepts Cartesian state vectors in **SI units** (metres,
    m/s) and returns the propagated trajectory evaluated on a uniform time
    grid.

    **Downsampling** — when ``max_points`` is set (default 500), the output
    is uniformly reduced for efficient 3D rendering.  Set to ``null`` to
    return the full-resolution result.

    **Metadata** — pass ``include_metadata: false`` to omit solver
    diagnostics from the response and save bandwidth.

    Each response includes a unique ``simulation_id`` (UUID4) for future
    caching, mission-saving, and result retrieval workflows.

    Raises
    ------
    HTTPException 400
        If the initial conditions fail physical-plausibility checks.
    HTTPException 500
        If the ODE solver fails to converge or an unexpected error occurs.
    """
    simulation_id = str(uuid.uuid4())

    try:
        # Convert lists → NumPy arrays
        r0 = np.array(request.initial_position, dtype=np.float64)
        v0 = np.array(request.initial_velocity, dtype=np.float64)

        # Offload CPU-bound propagation to a worker thread
        result = await asyncio.to_thread(
            propagate_orbit,
            initial_position=r0,
            initial_velocity=v0,
            time_span=request.time_span,
            time_step=request.time_step,
        )

        # ── Downsample for UI performance ───────────────────────────
        time_out = result.time
        pos_out = result.position
        vel_out = result.velocity

        if request.max_points is not None:
            time_out, pos_out, vel_out = _downsample(
                time_out, pos_out, vel_out, request.max_points,
            )

        # ── Build optional metadata ─────────────────────────────────
        metadata = None
        if request.include_metadata:
            metadata = SimulationMetadata(
                method=result.method,
                energy_drift_pct=result.energy_drift_pct,
                solver_evaluations=result.solver_evaluations,
                n_steps=result.n_steps,
            )

        # ── Serialise NumPy → plain Python ──────────────────────────
        return OrbitResponse(
            simulation_id=simulation_id,
            time=time_out.tolist(),
            position=pos_out.tolist(),
            velocity=vel_out.tolist(),
            metadata=metadata,
        )

    except ValueError as exc:
        logger.warning("Simulation rejected — invalid input: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    except RuntimeError as exc:
        logger.error("Simulation failed — solver error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    except Exception as exc:
        logger.exception("Unexpected error during orbit simulation")
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred during simulation.",
        ) from exc

