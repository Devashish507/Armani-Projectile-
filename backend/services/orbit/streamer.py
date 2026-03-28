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
from typing import AsyncGenerator

import numpy as np
from numpy.typing import NDArray

from services.orbit.propagator import propagate_orbit

logger = logging.getLogger(__name__)


# ── Frame data container ───────────────────────────────────────────


@dataclass(frozen=True)
class OrbitFrame:
    """Single simulation frame sent to the client."""

    step: int
    total_steps: int
    time: float
    position: tuple[float, float, float]
    velocity: tuple[float, float, float]


# ── Async streaming generator ──────────────────────────────────────


async def stream_orbit(
    initial_position: NDArray[np.float64],
    initial_velocity: NDArray[np.float64],
    time_span: float,
    time_step: float,
    stream_interval: float = 0.05,
) -> AsyncGenerator[OrbitFrame, None]:
    """Propagate an orbit and yield frames one-by-one in real time.

    The full trajectory is computed up-front (in a worker thread to
    avoid blocking the event loop) and then iterated step-by-step
    with *stream_interval* seconds between yields.

    Parameters
    ----------
    initial_position : (3,) array
        Cartesian position [x, y, z] in metres.
    initial_velocity : (3,) array
        Cartesian velocity [vx, vy, vz] in m/s.
    time_span : float
        Total simulation duration in seconds.
    time_step : float
        Output sample interval in seconds.
    stream_interval : float
        Delay between yielded frames in seconds (default 0.05 = 20 Hz).

    Yields
    ------
    OrbitFrame
        One position/velocity snapshot per simulation step.
    """
    logger.info(
        "Starting orbit stream — t_span=%.1f s, dt=%.1f s, interval=%.3f s",
        time_span,
        time_step,
        stream_interval,
    )

    # ── Run CPU-bound propagation off the event loop ────────────
    result = await asyncio.to_thread(
        propagate_orbit,
        initial_position=initial_position,
        initial_velocity=initial_velocity,
        time_span=time_span,
        time_step=time_step,
    )

    total_steps = len(result.time)
    logger.info("Orbit computed — %d steps, streaming at %.0f Hz", total_steps, 1 / stream_interval)

    # ── Yield frames one at a time ──────────────────────────────
    for i in range(total_steps):
        frame = OrbitFrame(
            step=i,
            total_steps=total_steps,
            time=float(result.time[i]),
            position=(
                float(result.position[i, 0]),
                float(result.position[i, 1]),
                float(result.position[i, 2]),
            ),
            velocity=(
                float(result.velocity[i, 0]),
                float(result.velocity[i, 1]),
                float(result.velocity[i, 2]),
            ),
        )
        yield frame

        # Real-time pacing — skip delay on last frame
        if i < total_steps - 1:
            await asyncio.sleep(stream_interval)

    logger.info("Orbit stream complete — %d frames sent", total_steps)
