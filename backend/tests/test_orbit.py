"""
Validation tests for the two-body orbit propagator.

Tests a circular Low-Earth-Orbit scenario and verifies:
    1. Orbital radius remains approximately constant (< 0.01 % deviation).
    2. Specific orbital energy is conserved (< 1e-6 % drift).
    3. Satellite returns close to its start after one full period.
"""

from __future__ import annotations

import sys
import numpy as np

# Ensure the backend root is on the path when running standalone
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

from core.constants import MU_EARTH
from services.orbit.propagator import propagate_orbit
from services.orbit.utils import orbital_radius, specific_orbital_energy


def test_circular_orbit() -> None:
    """Propagate a circular LEO and validate physical invariants."""

    # ── Initial conditions ──────────────────────────────────────────
    # Orbital altitude ≈ 629 km  →  radius = 7 000 km from Earth centre
    r0_mag = 7_000_000.0  # [m]

    # Circular velocity: v = √(μ / r)
    v0_mag = np.sqrt(MU_EARTH / r0_mag)  # ≈ 7 546 m/s

    # Position along +x, velocity along +y  →  prograde circular orbit
    initial_position = np.array([r0_mag, 0.0, 0.0])
    initial_velocity = np.array([0.0, v0_mag, 0.0])

    # Orbital period: T = 2π √(r³ / μ)
    period = 2.0 * np.pi * np.sqrt(r0_mag**3 / MU_EARTH)

    print(f"Orbital radius : {r0_mag / 1e3:.1f} km")
    print(f"Circular speed : {v0_mag:.2f} m/s  ({v0_mag / 1e3:.3f} km/s)")
    print(f"Orbital period : {period:.2f} s  ({period / 60:.1f} min)")
    print()

    # ── Propagate ───────────────────────────────────────────────────
    time_step = 10.0  # [s]
    result = propagate_orbit(
        initial_position=initial_position,
        initial_velocity=initial_velocity,
        time_span=period,
        time_step=time_step,
    )

    times = result["time"]
    positions = result["position"]
    velocities = result["velocity"]

    print(f"Propagated {len(times)} time steps over {times[-1]:.1f} s")
    print(f"Position array shape : {positions.shape}")
    print(f"Velocity array shape : {velocities.shape}")
    print()

    # ── Check 1: Radius stability ───────────────────────────────────
    radii = np.array([orbital_radius(p) for p in positions])
    max_radius_error_pct = np.max(np.abs(radii - r0_mag) / r0_mag) * 100

    print(f"Radius  — min: {radii.min() / 1e3:.4f} km, "
          f"max: {radii.max() / 1e3:.4f} km")
    print(f"Radius  — max deviation: {max_radius_error_pct:.6f} %")

    assert max_radius_error_pct < 0.01, (
        f"Radius deviation {max_radius_error_pct:.6f}% exceeds 0.01% threshold"
    )
    print("  ✓ Radius stays within 0.01 % of nominal\n")

    # ── Check 2: Energy conservation ────────────────────────────────
    energies = np.array([
        specific_orbital_energy(p, v)
        for p, v in zip(positions, velocities)
    ])
    energy_0 = energies[0]
    max_energy_error_pct = np.max(
        np.abs(energies - energy_0) / np.abs(energy_0)
    ) * 100

    print(f"Energy  — initial: {energy_0:.4f} J/kg")
    print(f"Energy  — max drift: {max_energy_error_pct:.8f} %")

    assert max_energy_error_pct < 1e-6, (
        f"Energy drift {max_energy_error_pct:.8f}% exceeds 1e-6% threshold"
    )
    print("  ✓ Energy conserved within 1e-6 %\n")

    # ── Check 3: Return to start ────────────────────────────────────
    final_position = positions[-1]
    position_error = np.linalg.norm(final_position - initial_position)
    position_error_pct = (position_error / r0_mag) * 100

    print(f"Return  — final position error: {position_error:.2f} m "
          f"({position_error_pct:.6f} %)")

    assert position_error_pct < 0.01, (
        f"Return error {position_error_pct:.6f}% exceeds 0.01% threshold"
    )
    print("  ✓ Satellite returns close to start\n")

    print("=" * 55)
    print("  ALL VALIDATION CHECKS PASSED")
    print("=" * 55)


if __name__ == "__main__":
    test_circular_orbit()
