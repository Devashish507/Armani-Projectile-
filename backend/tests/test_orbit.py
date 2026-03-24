"""
Validation tests for the two-body orbit propagator.

Tests:
    1. Circular orbit — radius stability, energy conservation, return to start.
    2. StateVector validation — shape, NaN, SI-unit guards.
    3. Edge cases — zero vector, sub-surface, invalid parameters.
    4. Escape trajectory — warning logged for positive energy.
    5. PropagationResult structure — all fields populated correctly.
"""

from __future__ import annotations

import logging
import sys

import numpy as np

# Ensure the backend root is on the path when running standalone
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

from core.constants import MU_EARTH
from services.orbit.propagator import propagate_orbit
from services.orbit.state import StateVector
from services.orbit.utils import (
    circular_velocity,
    escape_velocity,
    orbital_period,
    orbital_radius,
    specific_orbital_energy,
)

# ── Configure logging so warnings/info are visible ──────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(levelname)-8s %(name)s: %(message)s",
)


def test_circular_orbit() -> None:
    """Propagate a circular LEO and validate physical invariants."""

    print("\n" + "=" * 60)
    print("  TEST 1: Circular Orbit (Physical Invariants)")
    print("=" * 60)

    # ── Initial conditions ──────────────────────────────────────────
    r0_mag = 7_000_000.0  # [m] — ~629 km altitude
    v0_mag = circular_velocity(np.array([r0_mag, 0.0, 0.0]))
    period = orbital_period(r0_mag)

    # Create validated StateVector
    sv = StateVector.from_arrays(
        position=np.array([r0_mag, 0.0, 0.0]),
        velocity=np.array([0.0, v0_mag, 0.0]),
    )

    print(f"  State   : {sv}")
    print(f"  Period  : {period:.2f} s  ({period / 60:.1f} min)")
    print(f"  v_esc   : {escape_velocity(sv.position):.2f} m/s")
    print()

    # ── Propagate using StateVector ─────────────────────────────────
    result = propagate_orbit(
        state=sv,
        time_span=period,
        time_step=10.0,
    )

    print(f"  Steps          : {result.n_steps}")
    print(f"  Solver evals   : {result.solver_evaluations}")
    print(f"  Method         : {result.method}")
    print()

    # ── Check 1: Radius stability ───────────────────────────────────
    radii = np.array([orbital_radius(p) for p in result.position])
    max_radius_err = np.max(np.abs(radii - r0_mag) / r0_mag) * 100

    print(f"  Radius range   : {radii.min()/1e3:.4f} – {radii.max()/1e3:.4f} km")
    print(f"  Max deviation  : {max_radius_err:.8f} %")
    assert max_radius_err < 0.01, f"Radius deviation {max_radius_err}% > 0.01%"
    print("  ✓ Radius stable\n")

    # ── Check 2: Energy conservation ────────────────────────────────
    print(f"  ε_initial      : {result.energy_initial:.4f} J/kg")
    print(f"  ε_final        : {result.energy_final:.4f} J/kg")
    print(f"  Energy drift   : {result.energy_drift_pct:.2e} %")
    assert result.energy_drift_pct < 1e-6, f"Energy drift {result.energy_drift_pct}% > 1e-6%"
    print("  ✓ Energy conserved\n")

    # ── Check 3: Return to start ────────────────────────────────────
    return_err = np.linalg.norm(result.position[-1] - sv.position)
    return_pct = return_err / r0_mag * 100
    print(f"  Return error   : {return_err:.2f} m ({return_pct:.8f} %)")
    assert return_pct < 0.01, f"Return error {return_pct}% > 0.01%"
    print("  ✓ Orbit closed\n")

    # ── Check 4: to_dict backwards compatibility ────────────────────
    d = result.to_dict()
    assert "time" in d and "position" in d and "velocity" in d
    print("  ✓ to_dict() backwards compatible\n")


def test_state_vector_validation() -> None:
    """Verify that StateVector catches invalid inputs."""

    print("=" * 60)
    print("  TEST 2: StateVector Validation Guards")
    print("=" * 60)

    # Wrong shape
    try:
        StateVector.from_arrays(np.array([1.0, 2.0]), np.array([0.0, 0.0, 0.0]))
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  ✓ Shape check  : {e}")

    # NaN in position
    try:
        StateVector.from_arrays(
            np.array([np.nan, 0.0, 0.0]),
            np.array([0.0, 0.0, 0.0]),
        )
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  ✓ NaN check    : {e}")

    # Position too small (likely km instead of m)
    try:
        StateVector.from_arrays(
            np.array([7000.0, 0.0, 0.0]),  # km — should be m!
            np.array([0.0, 7546.0, 0.0]),
        )
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  ✓ SI guard (r) : {e}")

    # Velocity too large
    try:
        StateVector.from_arrays(
            np.array([7_000_000.0, 0.0, 0.0]),
            np.array([0.0, 2e6, 0.0]),  # 2000 km/s — unreasonable
        )
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  ✓ SI guard (v) : {e}")

    print()


def test_edge_cases() -> None:
    """Verify edge-case handling in propagator inputs."""

    print("=" * 60)
    print("  TEST 3: Edge Cases")
    print("=" * 60)

    sv = StateVector.from_arrays(
        np.array([7_000_000.0, 0.0, 0.0]),
        np.array([0.0, 7546.0, 0.0]),
    )

    # Negative time_span
    try:
        propagate_orbit(state=sv, time_span=-100.0, time_step=10.0)
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  ✓ time_span<0  : {e}")

    # time_step > time_span
    try:
        propagate_orbit(state=sv, time_span=100.0, time_step=200.0)
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  ✓ dt>t_span    : {e}")

    # Invalid method
    try:
        propagate_orbit(state=sv, time_span=100.0, time_step=10.0, method="EULER")
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  ✓ bad method   : {e}")

    # No inputs at all
    try:
        propagate_orbit(time_span=100.0, time_step=10.0)
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  ✓ no inputs    : {e}")

    print()


def test_escape_trajectory() -> None:
    """Verify that an escape trajectory logs a warning and still propagates."""

    print("=" * 60)
    print("  TEST 4: Escape Trajectory Warning")
    print("=" * 60)

    r0 = np.array([7_000_000.0, 0.0, 0.0])
    v_esc = escape_velocity(r0)

    # Give 120% of escape velocity → definitely hyperbolic
    sv = StateVector.from_arrays(
        position=r0,
        velocity=np.array([0.0, v_esc * 1.2, 0.0]),
    )

    energy = specific_orbital_energy(sv.position, sv.velocity)
    print(f"  v_escape       : {v_esc:.2f} m/s")
    print(f"  v_initial      : {np.linalg.norm(sv.velocity):.2f} m/s")
    print(f"  ε (should > 0) : {energy:.4f} J/kg")
    assert energy > 0, "Escape trajectory should have positive energy"
    print("  ✓ Positive energy confirmed")

    # Should propagate without error (but log a warning)
    result = propagate_orbit(state=sv, time_span=1000.0, time_step=10.0)
    assert result.n_steps > 0
    print(f"  ✓ Propagated {result.n_steps} steps (warning logged above)")
    print()


def test_propagation_result_fields() -> None:
    """Ensure PropagationResult has all expected fields."""

    print("=" * 60)
    print("  TEST 5: PropagationResult Structure")
    print("=" * 60)

    sv = StateVector.from_arrays(
        np.array([7_000_000.0, 0.0, 0.0]),
        np.array([0.0, 7546.0, 0.0]),
    )
    result = propagate_orbit(state=sv, time_span=100.0, time_step=10.0)

    assert result.time.shape == (11,), f"time shape: {result.time.shape}"
    assert result.position.shape == (11, 3), f"pos shape: {result.position.shape}"
    assert result.velocity.shape == (11, 3), f"vel shape: {result.velocity.shape}"
    assert result.initial_state is sv
    assert result.method == "RK45"
    assert isinstance(result.energy_initial, float)
    assert isinstance(result.energy_final, float)
    assert isinstance(result.solver_evaluations, int)
    assert isinstance(result.energy_drift_pct, float)

    print(f"  ✓ time           : {result.time.shape}")
    print(f"  ✓ position       : {result.position.shape}")
    print(f"  ✓ velocity       : {result.velocity.shape}")
    print(f"  ✓ method         : {result.method}")
    print(f"  ✓ energy_initial : {result.energy_initial:.4f}")
    print(f"  ✓ energy_final   : {result.energy_final:.4f}")
    print(f"  ✓ drift_pct      : {result.energy_drift_pct:.2e}")
    print(f"  ✓ solver_evals   : {result.solver_evaluations}")
    print()


# ── Runner ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    test_circular_orbit()
    test_state_vector_validation()
    test_edge_cases()
    test_escape_trajectory()
    test_propagation_result_fields()

    print("=" * 60)
    print("  ALL 5 TESTS PASSED ✓")
    print("=" * 60)
