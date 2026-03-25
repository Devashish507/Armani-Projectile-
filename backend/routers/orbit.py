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

import numpy as np
from fastapi import APIRouter, HTTPException

from models.orbit import OrbitRequest, OrbitResponse, SimulationMetadata
from services.orbit.propagator import propagate_orbit

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/orbit",
    tags=["Orbit"],
)


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

    The heavy numerical integration is offloaded to a thread so this
    coroutine does not block the event loop.

    Raises
    ------
    HTTPException 400
        If the initial conditions fail physical-plausibility checks
        (e.g. position below Earth's surface, velocity unreasonably high).
    HTTPException 500
        If the ODE solver fails to converge or an unexpected error occurs.
    """
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

        # Serialise NumPy arrays → plain Python lists
        return OrbitResponse(
            time=result.time.tolist(),
            position=result.position.tolist(),
            velocity=result.velocity.tolist(),
            metadata=SimulationMetadata(
                method=result.method,
                energy_drift_pct=result.energy_drift_pct,
                solver_evaluations=result.solver_evaluations,
                n_steps=result.n_steps,
            ),
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
