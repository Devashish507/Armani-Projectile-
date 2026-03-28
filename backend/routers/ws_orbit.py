"""
WebSocket orbit streaming router — ``/ws/orbit``.

Provides a real-time simulation channel where the client sends initial
orbit parameters and receives position/velocity frames one step at a
time.  Each connected client runs an independent simulation loop.

Protocol
--------
1. Client connects to ``ws://host/ws/orbit``
2. Client sends JSON with orbit parameters:
   ``{ "initial_position": [x,y,z], "initial_velocity": [vx,vy,vz],
       "time_span": float, "time_step": float }``
3. Server streams JSON frames:
   ``{ "type": "position_update", "time": t,
       "position": [x,y,z], "velocity": [vx,vy,vz],
       "step": i, "total_steps": N }``
4. Server sends: ``{ "type": "simulation_complete" }``
5. Connection remains open (client may send new parameters to restart).

Error handling
--------------
- Invalid parameters → server sends ``{ "type": "error", "detail": "..." }``
- Client disconnect → server stops streaming gracefully (no crash/leak).
"""

from __future__ import annotations

import json
import logging

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from models.orbit import WsOrbitParams
from services.orbit.streamer import stream_orbit

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket — Orbit"])


@router.websocket("/ws/orbit")
async def ws_orbit(websocket: WebSocket) -> None:
    """Stream orbit simulation frames to a connected client."""
    await websocket.accept()
    client_id = id(websocket)
    logger.info("[ws:%s] Client connected", client_id)

    try:
        # ── Wait for initial parameters from client ─────────────
        while True:
            raw = await websocket.receive_text()

            # ── Parse & validate ────────────────────────────────
            try:
                data = json.loads(raw)
                params = WsOrbitParams(**data)
            except (json.JSONDecodeError, ValidationError) as exc:
                error_msg = str(exc)
                logger.warning("[ws:%s] Invalid params: %s", client_id, error_msg)
                await websocket.send_json({
                    "type": "error",
                    "detail": error_msg,
                })
                continue  # let client retry with corrected params

            logger.info(
                "[ws:%s] Starting simulation — t_span=%.1f, dt=%.1f",
                client_id,
                params.time_span,
                params.time_step,
            )

            # ── Stream frames ───────────────────────────────────
            try:
                r0 = np.array(params.initial_position, dtype=np.float64)
                v0 = np.array(params.initial_velocity, dtype=np.float64)

                async for frame in stream_orbit(
                    initial_position=r0,
                    initial_velocity=v0,
                    time_span=params.time_span,
                    time_step=params.time_step,
                ):
                    await websocket.send_json({
                        "type": "position_update",
                        "time": frame.time,
                        "position": list(frame.position),
                        "velocity": list(frame.velocity),
                        "step": frame.step,
                        "total_steps": frame.total_steps,
                    })

                # ── Simulation finished ─────────────────────────
                await websocket.send_json({"type": "simulation_complete"})
                logger.info("[ws:%s] Simulation complete", client_id)

            except (ValueError, RuntimeError) as exc:
                logger.error("[ws:%s] Simulation error: %s", client_id, exc)
                await websocket.send_json({
                    "type": "error",
                    "detail": str(exc),
                })

            # After completion, loop back to wait for new params
            # (client can re-run with different initial conditions)

    except WebSocketDisconnect:
        logger.info("[ws:%s] Client disconnected", client_id)

    except Exception:
        logger.exception("[ws:%s] Unexpected error", client_id)
        # Connection is likely dead — nothing to send
