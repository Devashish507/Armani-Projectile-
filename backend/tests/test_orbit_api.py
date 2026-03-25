"""
API-level tests for the orbit simulation endpoint.

Uses FastAPI's TestClient (backed by httpx) to exercise the
``POST /api/v1/orbit/simulate`` route without starting a live server.

Tests cover:
    • Happy path — valid circular LEO request
    • Pydantic validation — missing fields, wrong vector lengths,
      negative time values, time_step > time_span
    • Engine-level rejection — position in kilometres instead of metres
    • Health endpoint — regression check
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure the backend root is on sys.path when running standalone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import app  # noqa: E402

client = TestClient(app)

# ── Fixtures ────────────────────────────────────────────────────────

VALID_PAYLOAD: dict = {
    "initial_position": [7_000_000.0, 0.0, 0.0],
    "initial_velocity": [0.0, 7546.0, 0.0],
    "time_span": 5400,
    "time_step": 10,
}


# ── Happy-path tests ───────────────────────────────────────────────


class TestSimulateSuccess:
    """Valid requests that should return 200."""

    def test_circular_orbit(self) -> None:
        """A standard circular-LEO request returns correct structure."""
        resp = client.post("/api/v1/orbit/simulate", json=VALID_PAYLOAD)

        assert resp.status_code == 200
        data = resp.json()

        # Top-level keys
        assert "time" in data
        assert "position" in data
        assert "velocity" in data
        assert "metadata" in data

        # Array lengths should match: (time_span / time_step) + 1 = 541
        expected_steps = int(VALID_PAYLOAD["time_span"] / VALID_PAYLOAD["time_step"]) + 1
        assert len(data["time"]) == expected_steps
        assert len(data["position"]) == expected_steps
        assert len(data["velocity"]) == expected_steps

        # Each position/velocity vector must be length 3
        assert len(data["position"][0]) == 3
        assert len(data["velocity"][0]) == 3

        # Metadata fields
        meta = data["metadata"]
        assert meta["method"] == "RK45"
        assert meta["n_steps"] == expected_steps
        assert isinstance(meta["energy_drift_pct"], float)
        assert isinstance(meta["solver_evaluations"], int)


# ── Validation tests (Pydantic → 422) ──────────────────────────────


class TestPydanticValidation:
    """Requests that should be rejected by Pydantic validators (422)."""

    def test_missing_field(self) -> None:
        """Omitting a required field returns 422."""
        payload = {
            "initial_position": [7_000_000.0, 0.0, 0.0],
            # initial_velocity missing
            "time_span": 5400,
            "time_step": 10,
        }
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422

    def test_position_wrong_length(self) -> None:
        """Position with ≠ 3 elements returns 422."""
        payload = {**VALID_PAYLOAD, "initial_position": [7_000_000.0, 0.0]}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422

    def test_velocity_wrong_length(self) -> None:
        """Velocity with ≠ 3 elements returns 422."""
        payload = {**VALID_PAYLOAD, "initial_velocity": [0.0, 7546.0, 0.0, 0.0]}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422

    def test_negative_time_span(self) -> None:
        """Negative time_span returns 422."""
        payload = {**VALID_PAYLOAD, "time_span": -100}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422

    def test_zero_time_step(self) -> None:
        """Zero time_step returns 422."""
        payload = {**VALID_PAYLOAD, "time_step": 0}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422

    def test_step_exceeds_span(self) -> None:
        """time_step > time_span returns 422."""
        payload = {**VALID_PAYLOAD, "time_span": 100, "time_step": 200}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422


# ── Engine-level rejection (→ 400) ─────────────────────────────────


class TestEngineValidation:
    """Requests that pass Pydantic but fail the engine's SI-unit guards."""

    def test_position_in_kilometres(self) -> None:
        """Position in km (not m) triggers the StateVector guard → 400."""
        payload = {
            "initial_position": [7000.0, 0.0, 0.0],   # km — should be m!
            "initial_velocity": [0.0, 7546.0, 0.0],
            "time_span": 100,
            "time_step": 10,
        }
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 400
        assert "metres" in resp.json()["detail"].lower() or "minimum" in resp.json()["detail"].lower()


# ── Health endpoint regression ──────────────────────────────────────


class TestHealthEndpoint:
    """Ensure the existing health endpoint still works."""

    def test_health_ok(self) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


# ── Runner ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
