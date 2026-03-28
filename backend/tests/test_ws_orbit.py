"""
API-level tests for the WebSocket orbit streaming endpoint.

Uses FastAPI's TestClient to connect to ``ws://.../ws/orbit`` and
verify the streaming protocol behavior.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import struct
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import app  # noqa: E402

client = TestClient(app)

# ── Fixtures ────────────────────────────────────────────────────────

VALID_WS_PAYLOAD: dict = {
    "initial_position": [7_000_000.0, 0.0, 0.0],
    "initial_velocity": [0.0, 7546.0, 0.0],
    "time_span": 100,
    "time_step": 10,
}


# ── Tests ──────────────────────────────────────────────────────────


class TestWebSocketStream:
    """Happy path WebSocket tests."""

    def test_full_stream(self) -> None:
        """Connect, send params, receive frames, and finish."""
        with client.websocket_connect("/ws/orbit") as websocket:
            # Send valid params
            websocket.send_json(VALID_WS_PAYLOAD)

            # Receive frames
            # time_span=100, time_step=10 -> 11 steps (0 to 100 incl)
            expected_steps = 11
            
            for i in range(expected_steps):
                data = websocket.receive_bytes()
                assert len(data) == 40, "Expected 40 bytes for position_update"
                unpacked = struct.unpack('<10f', data)
                
                assert unpacked[0] == 0.0  # type
                assert unpacked[8] == i    # step
                assert unpacked[9] == expected_steps # total_steps
                
            # Final message
            final = websocket.receive_bytes()
            assert len(final) == 4, "Expected 4 bytes for simulation_complete"
            assert struct.unpack('<f', final)[0] == 1.0


class TestWebSocketValidation:
    """Protocol error handling tests."""

    def test_invalid_params_format(self) -> None:
        """Send bad JSON or missing fields -> receive error, can retry."""
        with client.websocket_connect("/ws/orbit") as websocket:
            # Missing fields
            websocket.send_json({"initial_position": [0,0,0]})
            
            error = websocket.receive_json()
            assert error["type"] == "error"
            assert "detail" in error
            
            # The connection stays open; we can send valid params now
            websocket.send_json(VALID_WS_PAYLOAD)
            first_frame = websocket.receive_bytes()
            unpacked = struct.unpack('<10f', first_frame)
            assert unpacked[0] == 0.0
            assert unpacked[8] == 0.0

    def test_engine_rejection(self) -> None:
        """Send parameters that fail SI unit checks."""
        bad_payload = {
            **VALID_WS_PAYLOAD,
            "initial_position": [7000.0, 0.0, 0.0], # km instead of m
        }
        
        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(bad_payload)
            
            error = websocket.receive_json()
            assert error["type"] == "error"
            assert "magnitude" in error["detail"].lower() or "metres" in error["detail"].lower()
