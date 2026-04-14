"""
API-level tests for the orbit simulation endpoint.

Uses FastAPI's TestClient (backed by httpx) to exercise the
``POST /api/v1/orbit/simulate`` route without starting a live server.

Tests cover:
    • Happy path — valid circular LEO request
    • Pydantic validation — missing fields, wrong vector lengths,
      negative time values, time_step > time_span
    • Engine-level rejection — position in kilometres instead of metres
    • Downsampling — max_points caps output length
    • Metadata toggle — include_metadata=false omits diagnostics
    • Simulation ID — every response includes a UUID
    • Health endpoint — regression check
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure the backend root is on sys.path when running standalone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import app  # noqa: E402

client = TestClient(app)

# ── Fixtures ────────────────────────────────────────────────────────

VALID_PAYLOAD: dict = {
    "satellites": [
        {
            "id": "sat-1",
            "initial_position": [7_000_000.0, 0.0, 0.0],
            "initial_velocity": [0.0, 7546.0, 0.0],
        }
    ],
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
        assert "simulation_id" in data
        assert "satellites" in data
        assert "metadata" in data

        # Default max_points=500 → output capped at 500
        sat1 = data["satellites"][0]
        assert len(sat1["time"]) <= 500
        assert len(sat1["position"]) == len(sat1["time"])
        assert len(sat1["velocity"]) == len(sat1["time"])

        # Each position/velocity vector must be length 3
        assert len(sat1["position"][0]) == 3
        assert len(sat1["velocity"][0]) == 3

        # Metadata fields present (include_metadata defaults to true)
        meta = data["metadata"]
        assert meta["method"] == "RK45"
        assert isinstance(meta["energy_drift_pct"], float)
        assert isinstance(meta["solver_evaluations"], int)
        assert isinstance(meta["n_steps"], int)


# ── Simulation ID tests ────────────────────────────────────────────


class TestSimulationId:
    """Every response must include a valid UUID simulation_id."""

    def test_has_valid_uuid(self) -> None:
        resp = client.post("/api/v1/orbit/simulate", json=VALID_PAYLOAD)
        data = resp.json()
        # Should not raise
        parsed = uuid.UUID(data["simulation_id"])
        assert parsed.version == 4

    def test_unique_per_request(self) -> None:
        """Two requests must produce different simulation_ids."""
        r1 = client.post("/api/v1/orbit/simulate", json=VALID_PAYLOAD).json()
        r2 = client.post("/api/v1/orbit/simulate", json=VALID_PAYLOAD).json()
        assert r1["simulation_id"] != r2["simulation_id"]


# ── Downsampling tests ──────────────────────────────────────────────


class TestDownsampling:
    """Tests for the max_points downsampling parameter."""

    def test_default_caps_at_500(self) -> None:
        """Default max_points=500 caps a 541-point orbit."""
        resp = client.post("/api/v1/orbit/simulate", json=VALID_PAYLOAD)
        data = resp.json()
        assert len(data["satellites"][0]["time"]) == 500

    def test_custom_max_points(self) -> None:
        """Explicit max_points=100 reduces output to 100 points."""
        payload = {**VALID_PAYLOAD, "max_points": 100}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        data = resp.json()
        assert len(data["satellites"][0]["time"]) == 100
        assert len(data["satellites"][0]["position"]) == 100

    def test_null_disables_downsampling(self) -> None:
        """max_points=null returns full resolution."""
        payload = {**VALID_PAYLOAD, "max_points": None}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        data = resp.json()
        expected_steps = int(VALID_PAYLOAD["time_span"] / VALID_PAYLOAD["time_step"]) + 1
        assert len(data["satellites"][0]["time"]) == expected_steps

    def test_max_points_larger_than_output(self) -> None:
        """When max_points exceeds actual points, no downsampling occurs."""
        payload = {**VALID_PAYLOAD, "max_points": 10_000}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        data = resp.json()
        expected_steps = int(VALID_PAYLOAD["time_span"] / VALID_PAYLOAD["time_step"]) + 1
        assert len(data["satellites"][0]["time"]) == expected_steps

    def test_first_and_last_preserved(self) -> None:
        """Downsampled output still starts at t=0 and ends at t=time_span."""
        payload = {**VALID_PAYLOAD, "max_points": 50}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        data = resp.json()
        assert data["satellites"][0]["time"][0] == 0.0
        assert data["satellites"][0]["time"][-1] == pytest.approx(VALID_PAYLOAD["time_span"])

    def test_invalid_max_points_zero(self) -> None:
        """max_points=0 returns 422."""
        payload = {**VALID_PAYLOAD, "max_points": 0}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422


# ── Metadata toggle tests ──────────────────────────────────────────


class TestMetadataToggle:
    """Tests for the include_metadata flag."""

    def test_metadata_included_by_default(self) -> None:
        resp = client.post("/api/v1/orbit/simulate", json=VALID_PAYLOAD)
        data = resp.json()
        assert data["metadata"] is not None

    def test_metadata_excluded(self) -> None:
        """include_metadata=false omits solver diagnostics."""
        payload = {**VALID_PAYLOAD, "include_metadata": False}
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        data = resp.json()
        assert data["metadata"] is None


# ── Validation tests (Pydantic → 422) ──────────────────────────────


class TestPydanticValidation:
    """Requests that should be rejected by Pydantic validators (422)."""

    def test_missing_field(self) -> None:
        """Omitting a required field returns 422."""
        payload = {
            "satellites": [
                {
                    "id": "sat-1",
                    "initial_position": [7_000_000.0, 0.0, 0.0],
                    # initial_velocity missing
                }
            ],
            "time_span": 5400,
            "time_step": 10,
        }
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422

    def test_position_wrong_length(self) -> None:
        """Position with != 3 elements returns 422."""
        payload = {**VALID_PAYLOAD}
        payload["satellites"][0]["initial_position"] = [7_000_000.0, 0.0]
        resp = client.post("/api/v1/orbit/simulate", json=payload)
        assert resp.status_code == 422

    def test_velocity_wrong_length(self) -> None:
        """Velocity with != 3 elements returns 422."""
        payload = {**VALID_PAYLOAD}
        payload["satellites"][0]["initial_velocity"] = [0.0, 7546.0, 0.0, 0.0]
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
            "satellites": [
                {
                    "id": "sat-1",
                    "initial_position": [7000.0, 0.0, 0.0],   # km — should be m!
                    "initial_velocity": [0.0, 7546.0, 0.0],
                }
            ],
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
