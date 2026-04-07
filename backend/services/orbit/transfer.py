"""
Orbit transfer optimization — Hohmann Transfers.

Computes velocity changes and mathematically simulates the continuous
three-phase trajectory required to transfer between two circular orbits.
"""

from __future__ import annotations

import numpy as np

from core.constants import MU_EARTH
from services.orbit.propagator import propagate_orbit


def compute_hohmann_transfer(r1: float, r2: float, mu: float = MU_EARTH) -> dict:
    """Compute delta-v and transfer time for a Hohmann transfer.

    Returns the scalar velocity changes. A positive delta-v indicates an
    acceleration in the direction of motion (prograde), while a negative
    delta-v corresponds to a deceleration (retrograde).

    Parameters
    ----------
    r1 : float
        Initial circular orbit radius [m].
    r2 : float
        Target circular orbit radius [m].
    mu : float, optional
        Gravitational parameter. Defaults to Earth's.

    Returns
    -------
    dict
        Contains delta_v1, delta_v2, total_delta_v, and transfer_time.
    """
    # Circular orbit velocities
    v1 = np.sqrt(mu / r1)
    v2 = np.sqrt(mu / r2)

    # Transfer ellipse semi-major axis
    a_trans = (r1 + r2) / 2.0

    # Velocities on the transfer ellipse at periapsis and apoapsis
    # These formulas apply gracefully to both orbit raising and lowering.
    v_trans_1 = np.sqrt(mu * (2.0 / r1 - 1.0 / a_trans))
    v_trans_2 = np.sqrt(mu * (2.0 / r2 - 1.0 / a_trans))

    # Calculate required velocity changes
    # Orbit Raising (r1 < r2): dv1 > 0, dv2 > 0
    # Orbit Lowering (r1 > r2): dv1 < 0, dv2 < 0
    dv1 = v_trans_1 - v1
    dv2 = v2 - v_trans_2

    # Transfer time is half the orbital period of the transfer ellipse
    t_trans = np.pi * np.sqrt(a_trans**3 / mu)

    return {
        "delta_v1": dv1,
        "delta_v2": dv2,
        "total_delta_v": abs(dv1) + abs(dv2),
        "transfer_time": t_trans,
    }


def generate_transfer_trajectory(
    r1: float, r2: float, mu: float = MU_EARTH
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Generate a continuous 3-phase trajectory for the Hohmann transfer.

    Propagates exactly three phases:
    1. Initial circular orbit for 1 period.
    2. Transfer ellipse for half a period (t_trans).
    3. Final circular orbit for 1 period.

    Returns concatenated (time, position, velocity) downsampled arrays.
    """
    transfer_params = compute_hohmann_transfer(r1, r2, mu)
    t_trans = transfer_params["transfer_time"]

    # Calculate circular orbit periods
    t1 = 2 * np.pi * np.sqrt(r1**3 / mu)
    t2 = 2 * np.pi * np.sqrt(r2**3 / mu)

    # Speeds
    v1 = np.sqrt(mu / r1)
    v2 = np.sqrt(mu / r2)
    a_trans = (r1 + r2) / 2.0
    v_trans_1 = np.sqrt(mu * (2.0 / r1 - 1.0 / a_trans))

    # Phase 1: Initial Orbit (1 period)
    p1_start = np.array([r1, 0.0, 0.0])
    v1_start = np.array([0.0, v1, 0.0])
    res1 = propagate_orbit(
        initial_position=p1_start,
        initial_velocity=v1_start,
        time_span=t1,
        time_step=t1 / 200.0,
        mu=mu,
    )

    # Phase 2: Transfer Orbit
    # Apply instantaneous impulsive Burn 1
    p2_start = res1.position[-1]
    v_unit_1 = res1.velocity[-1] / np.linalg.norm(res1.velocity[-1])
    v2_start = v_unit_1 * v_trans_1

    res2 = propagate_orbit(
        initial_position=p2_start,
        initial_velocity=v2_start,
        time_span=t_trans,
        time_step=t_trans / 100.0,
        mu=mu,
    )

    # Phase 3: Final Orbit (1 period)
    # Apply instantaneous impulsive Burn 2
    p3_start = res2.position[-1]
    v_unit_2 = res2.velocity[-1] / np.linalg.norm(res2.velocity[-1])
    v3_start = v_unit_2 * v2

    res3 = propagate_orbit(
        initial_position=p3_start,
        initial_velocity=v3_start,
        time_span=t2,
        time_step=t2 / 200.0,
        mu=mu,
    )

    # Combine responses to a continuous trajectory.
    # Exclude the first point of subsequent phases to avoid duplicate timestamps.
    time_out = np.concatenate([
        res1.time,
        res2.time[1:] + res1.time[-1],
        res3.time[1:] + res1.time[-1] + res2.time[-1],
    ])

    pos_out = np.vstack([res1.position, res2.position[1:], res3.position[1:]])
    vel_out = np.vstack([res1.velocity, res2.velocity[1:], res3.velocity[1:]])

    return time_out, pos_out, vel_out
