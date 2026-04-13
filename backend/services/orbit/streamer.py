"""
Orbit streaming service — step-by-step trajectory delivery.

Pre-computes the full orbit using the existing propagation engine,
then yields position/velocity updates one step at a time with a
configurable delay between yields.  This keeps the simulation logic
in the service layer (reusing tested code) while giving WebSocket
handlers a simple async generator to iterate.

All values are in **SI units** (metres, m/s, seconds).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import AsyncGenerator, Any

import numpy as np
from numpy.typing import NDArray

from services.orbit.propagator import propagate_orbit

logger = logging.getLogger(__name__)


# ── Frame data container ───────────────────────────────────────────


@dataclass(frozen=True)
class OrbitFrame:
    """Single simulation frame sent to the client."""

    seq_id: int
    step: int
    total_steps: int
    time: float
    position: tuple[float, float, float]
    velocity: tuple[float, float, float]


# ── Async streaming generator ──────────────────────────────────────


async def stream_constellation(
    satellites: list[Any],  # list of SatelliteConfig from models
    time_span: float,
    time_step: float,
    stream_interval: float = 0.05,
) -> AsyncGenerator[list[dict[str, Any]], None]:
    """Propagate multiple orbits and yield frames one-by-one in real time.

    The full trajectories are computed up-front (in worker threads) and then
    iterated step-by-step with *stream_interval* seconds between yields.
    Yields a list of satellite updates per step.

    Yields
    ------
    list[dict]
        A list of JSON-serializable dictionaries containing id, position, velocity, etc.
    """
    logger.info(
        "Starting constellation stream — %d sats, t_span=%.1f s, dt=%.1f s",
        len(satellites),
        time_span,
        time_step,
    )

    # ── Run CPU-bound propagation off the event loop ────────────
    # We can run them concurrently using asyncio.gather
    async def _propagate(sat):
        result = await asyncio.to_thread(
            propagate_orbit,
            initial_position=np.array(sat.initial_position, dtype=np.float64),
            initial_velocity=np.array(sat.initial_velocity, dtype=np.float64),
            time_span=time_span,
            time_step=time_step,
        )
        return sat.id, result

    results = await asyncio.gather(*[_propagate(sat) for sat in satellites])
    
    if not results:
        return

    # All propagations use the same time evaluations, so they have the same steps
    total_steps = len(results[0][1].time)
    logger.info("Constellation computed — %d steps", total_steps)

    # ── Yield frames one at a time ──────────────────────────────
    for i in range(total_steps):
        step_frames = []
        for sat_id, result in results:
            step_frames.append({
                "type": "position_update",
                "id": sat_id,
                "time": float(result.time[i]),
                "position": [
                    float(result.position[i, 0]),
                    float(result.position[i, 1]),
                    float(result.position[i, 2]),
                ],
                "velocity": [
                    float(result.velocity[i, 0]),
                    float(result.velocity[i, 1]),
                    float(result.velocity[i, 2]),
                ],
                "step": i,
                "total_steps": total_steps,
            })
        
        yield step_frames

        # Real-time pacing — skip delay on last frame
        if i < total_steps - 1:
            await asyncio.sleep(stream_interval)

    logger.info("Constellation stream complete — %d frames sent", total_steps)
