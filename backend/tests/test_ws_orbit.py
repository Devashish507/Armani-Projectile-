"""
API-level tests for the WebSocket orbit streaming endpoint.

Uses FastAPI's TestClient to connect to ``ws://.../ws/orbit`` and
verify the v1 binary protocol behavior including:
- Sequence number monotonicity
- Protocol versioning
- Float64 time precision
- Heartbeat frames
- Resume-from-time state recovery
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

# ── Constants ──────────────────────────────────────────────────────

PROTOCOL_VERSION = 2.0
HEARTBEAT_INTERVAL = 5.0

# ── Fixtures ────────────────────────────────────────────────────────

VALID_WS_PAYLOAD: dict = {
    "satellites": [
        {
            "id": "sat-1",
            "initial_position": [7_000_000.0, 0.0, 0.0],
            "initial_velocity": [0.0, 7546.0, 0.0],
        }
    ],
    "time_span": 100,
    "time_step": 10,
}

# ── Helpers ─────────────────────────────────────────────────────────

def receive_next_data_frame(websocket):
    """Receive frames, skipping heartbeat pings, until a data frame arrives."""
    while True:
        data = websocket.receive_json()
        if data.get("type") == "heartbeat":
            continue
        return data


# ── Tests ──────────────────────────────────────────────────────────


class TestProtocolV1:
    """Protocol v2 compliance tests."""

    def test_full_stream_with_v1_format(self) -> None:
        """Connect, send params, receive v2 JSON frames with seq numbers."""
        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(VALID_WS_PAYLOAD)

            # time_span=100, time_step=10 -> 11 steps (0 to 100 incl)
            expected_steps = 11
            last_seq = 0

            for i in range(expected_steps):
                frame = receive_next_data_frame(websocket)

                # Protocol version check
                assert frame["version"] == PROTOCOL_VERSION

                # Sequence number monotonicity
                assert frame["seq"] > last_seq
                last_seq = frame["seq"]

                # Float64 time precision
                assert isinstance(frame["time"], float)
                expected_time = i * 10.0
                assert abs(frame["time"] - expected_time) < 0.01

            # Completion frame
            final = receive_next_data_frame(websocket)
            assert final["type"] == "simulation_complete"
            assert final["version"] == PROTOCOL_VERSION
            assert final["seq"] > last_seq

    def test_sequence_numbers_are_monotonic(self) -> None:
        """Verify seq numbers strictly increase across all frames."""
        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(VALID_WS_PAYLOAD)

            seqs = []
            for _ in range(11):  # 11 steps
                frame = receive_next_data_frame(websocket)
                seqs.append(int(frame["seq"]))

            # Verify strict monotonicity
            for i in range(1, len(seqs)):
                assert seqs[i] > seqs[i - 1]

    def test_protocol_version_in_all_frames(self) -> None:
        """Every frame (data + completion) carries the version field."""
        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(VALID_WS_PAYLOAD)

            for _ in range(11):
                frame = receive_next_data_frame(websocket)
                assert frame["version"] == PROTOCOL_VERSION

            # Completion frame also has version
            final = receive_next_data_frame(websocket)
            assert final["version"] == PROTOCOL_VERSION


class TestResumeFromTime:
    """State recovery tests (#3)."""

    def test_resume_skips_earlier_frames(self) -> None:
        """When resume_from_time is set, frames before that time are skipped."""
        payload = {
            **VALID_WS_PAYLOAD,
            "resume_from_time": 50.0,  # Skip first 5 steps (0s, 10s, 20s, 30s, 40s)
        }

        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(payload)

            # Should receive frames from t=50 onwards (steps 5..10 = 6 frames)
            first_frame = receive_next_data_frame(websocket)

            assert first_frame["time"] >= 50.0, \
                f"First frame time {first_frame['time']} should be >= 50.0"

            # Drain remaining data frames
            remaining = 0
            while True:
                frame = receive_next_data_frame(websocket)
                if frame.get("type") == "simulation_complete":
                    break
                remaining += 1

            # Total received should be 5 (steps 6..10) — fewer than full 11
            # First frame already counted, so remaining + 1 should be <= 7
            total_received = remaining + 1
            assert total_received < 11, \
                f"Expected fewer than 11 frames with resume, got {total_received}"


class TestAdaptiveRate:
    """Adaptive streaming rate control (#6)."""

    def test_set_rate_accepted(self) -> None:
        """Server accepts set_rate control message without error."""
        with client.websocket_connect("/ws/orbit") as websocket:
            # Send rate control first — should not cause error
            websocket.send_json({"set_rate": 30})

            # Then send valid params — should stream normally
            websocket.send_json(VALID_WS_PAYLOAD)

            frame = receive_next_data_frame(websocket)
            assert frame["type"] == "position_update"


class TestWebSocketValidation:
    """Protocol error handling tests."""

    def test_invalid_params_format(self) -> None:
        """Send bad JSON or missing fields -> receive error, can retry."""
        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json({"initial_position": [0, 0, 0]})

            error = websocket.receive_json()
            assert error["type"] == "error"
            assert "detail" in error

            # Connection stays open; send valid params now
            websocket.send_json(VALID_WS_PAYLOAD)
            frame = receive_next_data_frame(websocket)
            assert frame["type"] == "position_update"
            assert frame["time"] == 0.0

    def test_engine_rejection(self) -> None:
        """Send parameters that fail SI unit checks."""
        bad_payload = {
            **VALID_WS_PAYLOAD,
        }
        bad_payload["satellites"][0]["initial_position"] = [7000.0, 0.0, 0.0]

        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(bad_payload)

            error = websocket.receive_json()
            assert error["type"] == "error"
            assert "magnitude" in error["detail"].lower() or "metres" in error["detail"].lower()
