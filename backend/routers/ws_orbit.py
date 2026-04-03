"""
WebSocket orbit streaming router — ``/ws/orbit``.

Protocol v1 — Elite Binary Streaming
-------------------------------------
1. Client connects to ``ws://host/ws/orbit``
2. Client sends JSON with orbit parameters:
   ``{ "initial_position": [x,y,z], "initial_velocity": [vx,vy,vz],
       "time_span": float, "time_step": float,
       "resume_from_time": float|null }``
3. Server streams binary frames (see FRAME LAYOUT below)
4. Server sends heartbeat pings every HEARTBEAT_INTERVAL seconds
5. Server sends completion frame when simulation ends
6. Connection remains open (client may send new parameters to restart)

Binary Frame Layout (v1)
------------------------
Position update (52 bytes):
    [version:f32, type:f32, seq:f32, time:f64,
     px:f32, py:f32, pz:f32, vx:f32, vy:f32, vz:f32,
     step:f32, total_steps:f32]
    struct format: '<3f d 8f'

Completion (12 bytes):
    [version:f32, type:f32, seq:f32]
    struct format: '<3f'

Heartbeat ping (12 bytes):
    [version:f32, type:f32, server_time:f32]
    struct format: '<3f'

Type markers: 0.0 = position_update, 1.0 = complete, 2.0 = heartbeat

Error handling
--------------
- Invalid parameters → server sends ``{ "type": "error", "detail": "..." }``
- Client disconnect → server stops streaming gracefully (no crash/leak).
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import time

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from models.orbit import WsOrbitParams
from services.orbit.streamer import stream_orbit

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket — Orbit"])

# ── Protocol constants ──────────────────────────────────────────────

PROTOCOL_VERSION: float = 1.0
HEARTBEAT_INTERVAL: float = 5.0  # seconds between pings
HEARTBEAT_TIMEOUT: float = 15.0  # close if no pong in this time
DEFAULT_STREAM_HZ: float = 20.0  # default streaming rate
MIN_STREAM_HZ: float = 5.0
MAX_STREAM_HZ: float = 60.0

# ── Frame packing helpers ──────────────────────────────────────────

# Position update: version(f32) + type(f32) + seq(f32) + time(f64)
#                  + px,py,pz(3×f32) + vx,vy,vz(3×f32)
#                  + step(f32) + total_steps(f32)
# Total: 3×4 + 8 + 8×4 = 12 + 8 + 32 = 52 bytes
FRAME_FORMAT_POSITION = '<3f d 8f'

# Completion / Heartbeat: version(f32) + type(f32) + seq_or_time(f32)
FRAME_FORMAT_CONTROL = '<3f'


def pack_position_frame(
    seq: int,
    sim_time: float,
    position: tuple[float, float, float],
    velocity: tuple[float, float, float],
    step: int,
    total_steps: int,
) -> bytes:
    """Pack a position update into the v1 binary format (52 bytes)."""
    return struct.pack(
        FRAME_FORMAT_POSITION,
        PROTOCOL_VERSION,   # version
        0.0,                # type: position_update
        float(seq),         # sequence number
        sim_time,           # Float64 time (high precision)
        position[0], position[1], position[2],
        velocity[0], velocity[1], velocity[2],
        float(step),
        float(total_steps),
    )


def pack_completion_frame(seq: int) -> bytes:
    """Pack a simulation-complete marker (12 bytes)."""
    return struct.pack(FRAME_FORMAT_CONTROL, PROTOCOL_VERSION, 1.0, float(seq))


def pack_heartbeat_frame() -> bytes:
    """Pack a heartbeat ping (12 bytes)."""
    return struct.pack(FRAME_FORMAT_CONTROL, PROTOCOL_VERSION, 2.0, time.time())


# ── WebSocket endpoint ─────────────────────────────────────────────


@router.websocket("/ws/orbit")
async def ws_orbit(websocket: WebSocket) -> None:
    """Stream orbit simulation frames to a connected client."""
    await websocket.accept()
    client_id = id(websocket)
    logger.info("[ws:%s] Client connected (protocol v%s)", client_id, int(PROTOCOL_VERSION))

    # Mutable state for this connection
    seq_counter = 0
    stream_interval = 1.0 / DEFAULT_STREAM_HZ
    heartbeat_task: asyncio.Task | None = None
    alive = True

    # ── Heartbeat background task ───────────────────────────────
    async def heartbeat_loop() -> None:
        """Send periodic heartbeat pings to detect dead connections."""
        nonlocal alive
        try:
            while alive:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                if not alive:
                    break
                try:
                    await websocket.send_bytes(pack_heartbeat_frame())
                except Exception:
                    alive = False
                    break
        except asyncio.CancelledError:
            pass

    try:
        # Start heartbeat
        heartbeat_task = asyncio.create_task(heartbeat_loop())

        # ── Wait for parameters from client ─────────────────────
        while alive:
            raw = await websocket.receive_text()

            # ── Handle control messages ─────────────────────────
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                await websocket.send_json({
                    "type": "error",
                    "detail": str(exc),
                })
                continue

            # Adaptive rate control: client can send {"set_rate": hz}
            if "set_rate" in data:
                requested_hz = float(data["set_rate"])
                clamped_hz = max(MIN_STREAM_HZ, min(MAX_STREAM_HZ, requested_hz))
                stream_interval = 1.0 / clamped_hz
                logger.info(
                    "[ws:%s] Stream rate adjusted to %.0f Hz",
                    client_id, clamped_hz,
                )
                continue

            # ── Parse orbit parameters ──────────────────────────
            try:
                params = WsOrbitParams(**data)
            except ValidationError as exc:
                error_msg = str(exc)
                logger.warning("[ws:%s] Invalid params: %s", client_id, error_msg)
                await websocket.send_json({
                    "type": "error",
                    "detail": error_msg,
                })
                continue

            logger.info(
                "[ws:%s] Starting simulation — t_span=%.1f, dt=%.1f, resume=%.1f",
                client_id,
                params.time_span,
                params.time_step,
                params.resume_from_time or 0.0,
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
                    stream_interval=stream_interval,
                ):
                    if not alive:
                        break

                    # Skip frames before resume point (#3 state recovery)
                    if (
                        params.resume_from_time is not None
                        and frame.time < params.resume_from_time
                    ):
                        continue

                    seq_counter += 1

                    packed = pack_position_frame(
                        seq=seq_counter,
                        sim_time=frame.time,
                        position=frame.position,
                        velocity=frame.velocity,
                        step=frame.step,
                        total_steps=frame.total_steps,
                    )
                    await websocket.send_bytes(packed)

                # ── Simulation finished ─────────────────────────
                if alive:
                    seq_counter += 1
                    await websocket.send_bytes(pack_completion_frame(seq_counter))
                    logger.info("[ws:%s] Simulation complete (seq=%d)", client_id, seq_counter)

            except (ValueError, RuntimeError) as exc:
                logger.error("[ws:%s] Simulation error: %s", client_id, exc)
                await websocket.send_json({
                    "type": "error",
                    "detail": str(exc),
                })

            # After completion, loop back to wait for new params

    except WebSocketDisconnect:
        logger.info("[ws:%s] Client disconnected", client_id)

    except Exception:
        logger.exception("[ws:%s] Unexpected error", client_id)

    finally:
        alive = False
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
