"""
WebSocket orbit streaming router — ``/ws/orbit``.

Protocol v2 — JSON Constellation Streaming
-------------------------------------
1. Client connects to ``ws://host/ws/orbit``
2. Client sends JSON with orbit parameters (WsOrbitParams)
3. Server streams JSON frames per satellite:
   ``{ "type": "position_update", "id": "...", "position": [...], "velocity": [...], ... }``
4. Server sends heartbeat pings every HEARTBEAT_INTERVAL seconds
5. Server sends completion frame when simulation ends
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from models.orbit import WsOrbitParams
from services.orbit.streamer import stream_constellation

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket — Orbit"])

# ── Protocol constants ──────────────────────────────────────────────

PROTOCOL_VERSION: float = 2.0
HEARTBEAT_INTERVAL: float = 5.0
HEARTBEAT_TIMEOUT: float = 15.0
DEFAULT_STREAM_HZ: float = 20.0
MIN_STREAM_HZ: float = 5.0
MAX_STREAM_HZ: float = 60.0

@router.websocket("/ws/orbit")
async def ws_orbit(websocket: WebSocket) -> None:
    """Stream constellation simulation frames to a connected client."""
    await websocket.accept()
    client_id = id(websocket)
    logger.info("[ws:%s] Client connected (protocol v%s)", client_id, int(PROTOCOL_VERSION))

    seq_counter = 0
    stream_interval = 1.0 / DEFAULT_STREAM_HZ
    heartbeat_task: asyncio.Task | None = None
    alive = True

    # ── Heartbeat task ──────────────────────────────────────────────
    async def heartbeat_loop() -> None:
        nonlocal alive
        try:
            while alive:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                if not alive:
                    break
                try:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "version": PROTOCOL_VERSION,
                        "serverTime": time.time()
                    })
                except Exception:
                    alive = False
                    break
        except asyncio.CancelledError:
            pass

    try:
        heartbeat_task = asyncio.create_task(heartbeat_loop())

        while alive:
            raw = await websocket.receive_text()

            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                await websocket.send_json({"type": "error", "detail": str(exc)})
                continue

            # Adaptive rate control
            if "set_rate" in data:
                requested_hz = float(data["set_rate"])
                clamped_hz = max(MIN_STREAM_HZ, min(MAX_STREAM_HZ, requested_hz))
                stream_interval = 1.0 / clamped_hz
                continue

            try:
                params = WsOrbitParams(**data)
            except ValidationError as exc:
                await websocket.send_json({"type": "error", "detail": str(exc)})
                continue

            logger.info("[ws:%s] Starting constellation stream", client_id)

            try:
                async for step_frames in stream_constellation(
                    satellites=params.satellites,
                    time_span=params.time_span,
                    time_step=params.time_step,
                    stream_interval=stream_interval,
                ):
                    if not alive:
                        break
                    
                    if not step_frames:
                        continue
                    
                    # Handle state recovery skips using the first satellite's time
                    if (
                        params.resume_from_time is not None
                        and step_frames[0]["time"] < params.resume_from_time
                    ):
                        continue

                    seq_counter += 1
                    
                    # Send frames for all satellites
                    for frame in step_frames:
                        frame["seq"] = seq_counter
                        frame["version"] = PROTOCOL_VERSION
                        await websocket.send_json(frame)

                # Send completion
                if alive:
                    seq_counter += 1
                    await websocket.send_json({
                        "type": "simulation_complete",
                        "version": PROTOCOL_VERSION,
                        "seq": seq_counter
                    })
            except Exception as exc:
                logger.error("[ws:%s] Error: %s", client_id, exc)
                await websocket.send_json({"type": "error", "detail": str(exc)})

    except WebSocketDisconnect:
        logger.info("[ws:%s] Client disconnected", client_id)
    except Exception:
        logger.exception("[ws:%s] Unexpected error", client_id)
    finally:
        alive = False
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()
