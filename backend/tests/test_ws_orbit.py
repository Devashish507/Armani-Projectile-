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

PROTOCOL_VERSION = 1.0
FRAME_FORMAT_POSITION = '<3f d 8f'  # 52 bytes
FRAME_FORMAT_CONTROL = '<3f'        # 12 bytes
POSITION_FRAME_SIZE = struct.calcsize(FRAME_FORMAT_POSITION)  # 52
CONTROL_FRAME_SIZE = struct.calcsize(FRAME_FORMAT_CONTROL)    # 12

# ── Fixtures ────────────────────────────────────────────────────────

VALID_WS_PAYLOAD: dict = {
    "initial_position": [7_000_000.0, 0.0, 0.0],
    "initial_velocity": [0.0, 7546.0, 0.0],
    "time_span": 100,
    "time_step": 10,
}


# ── Helpers ─────────────────────────────────────────────────────────

def receive_next_data_frame(websocket):
    """Receive frames, skipping heartbeat pings, until a data frame arrives."""
    while True:
        data = websocket.receive_bytes()
        if len(data) == CONTROL_FRAME_SIZE:
            unpacked = struct.unpack(FRAME_FORMAT_CONTROL, data)
            if unpacked[1] == 2.0:  # heartbeat
                continue
        return data


def unpack_position_frame(data: bytes):
    """Unpack a position update frame and return a dict."""
    assert len(data) == POSITION_FRAME_SIZE, f"Expected {POSITION_FRAME_SIZE} bytes, got {len(data)}"
    values = struct.unpack(FRAME_FORMAT_POSITION, data)
    return {
        "version": values[0],
        "type": values[1],
        "seq": values[2],
        "time": values[3],        # Float64
        "px": values[4], "py": values[5], "pz": values[6],
        "vx": values[7], "vy": values[8], "vz": values[9],
        "step": values[10],
        "total_steps": values[11],
    }


# ── Tests ──────────────────────────────────────────────────────────


class TestProtocolV1:
    """Protocol v1 compliance tests."""

    def test_full_stream_with_v1_format(self) -> None:
        """Connect, send params, receive v1 frames with seq numbers."""
        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(VALID_WS_PAYLOAD)

            # time_span=100, time_step=10 -> 11 steps (0 to 100 incl)
            expected_steps = 11
            last_seq = 0

            for i in range(expected_steps):
                data = receive_next_data_frame(websocket)
                frame = unpack_position_frame(data)

                # Protocol version check (#4)
                assert frame["version"] == PROTOCOL_VERSION, \
                    f"Expected version {PROTOCOL_VERSION}, got {frame['version']}"

                # Type check
                assert frame["type"] == 0.0, f"Expected type 0.0, got {frame['type']}"

                # Sequence number monotonicity (#1)
                assert frame["seq"] > last_seq, \
                    f"Seq {frame['seq']} should be > {last_seq}"
                last_seq = frame["seq"]

                # Step validation
                assert frame["step"] == i, f"Expected step {i}, got {frame['step']}"
                assert frame["total_steps"] == expected_steps

                # Float64 time precision (#5)
                # time should be a valid float, not truncated
                assert isinstance(frame["time"], float)
                expected_time = i * 10.0
                assert abs(frame["time"] - expected_time) < 0.01, \
                    f"Time {frame['time']} differs from expected {expected_time}"

            # Completion frame
            final = receive_next_data_frame(websocket)
            assert len(final) == CONTROL_FRAME_SIZE
            unpacked = struct.unpack(FRAME_FORMAT_CONTROL, final)
            assert unpacked[0] == PROTOCOL_VERSION  # version
            assert unpacked[1] == 1.0               # type: complete
            assert unpacked[2] > last_seq            # seq incremented

    def test_sequence_numbers_are_monotonic(self) -> None:
        """Verify seq numbers strictly increase across all frames."""
        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(VALID_WS_PAYLOAD)

            seqs = []
            for _ in range(11):  # 11 steps
                data = receive_next_data_frame(websocket)
                frame = unpack_position_frame(data)
                seqs.append(int(frame["seq"]))

            # Verify strict monotonicity
            for i in range(1, len(seqs)):
                assert seqs[i] > seqs[i - 1], \
                    f"Seq[{i}]={seqs[i]} not > Seq[{i-1}]={seqs[i-1]}"

    def test_protocol_version_in_all_frames(self) -> None:
        """Every frame (data + completion) carries the version field."""
        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(VALID_WS_PAYLOAD)

            for _ in range(11):
                data = receive_next_data_frame(websocket)
                frame = unpack_position_frame(data)
                assert frame["version"] == PROTOCOL_VERSION

            # Completion frame also has version
            final = receive_next_data_frame(websocket)
            unpacked = struct.unpack(FRAME_FORMAT_CONTROL, final)
            assert unpacked[0] == PROTOCOL_VERSION


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
            first_data = receive_next_data_frame(websocket)
            first_frame = unpack_position_frame(first_data)

            assert first_frame["time"] >= 50.0, \
                f"First frame time {first_frame['time']} should be >= 50.0"

            # Drain remaining data frames
            remaining = 0
            while True:
                data = receive_next_data_frame(websocket)
                if len(data) == CONTROL_FRAME_SIZE:
                    unpacked = struct.unpack(FRAME_FORMAT_CONTROL, data)
                    if unpacked[1] == 1.0:  # complete
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

            data = receive_next_data_frame(websocket)
            frame = unpack_position_frame(data)
            assert frame["type"] == 0.0


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
            first_frame = receive_next_data_frame(websocket)
            frame = unpack_position_frame(first_frame)
            assert frame["type"] == 0.0
            assert frame["step"] == 0.0

    def test_engine_rejection(self) -> None:
        """Send parameters that fail SI unit checks."""
        bad_payload = {
            **VALID_WS_PAYLOAD,
            "initial_position": [7000.0, 0.0, 0.0],
        }

        with client.websocket_connect("/ws/orbit") as websocket:
            websocket.send_json(bad_payload)

            error = websocket.receive_json()
            assert error["type"] == "error"
            assert "magnitude" in error["detail"].lower() or "metres" in error["detail"].lower()
