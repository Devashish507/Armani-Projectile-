"""
Equations of motion for Keplerian (two-body) orbital mechanics.

The central equation is Newton's law of gravitation applied to two bodies
where one body (the satellite) has negligible mass compared to the primary
(Earth).  The resulting acceleration on the satellite is:

    a = -μ · r / |r|³

where
    r  = position vector of the satellite relative to Earth centre  [m]
    μ  = standard gravitational parameter of Earth                  [m³ s⁻²]
    a  = inertial acceleration vector                               [m s⁻²]

This module exposes:
    • two_body_acceleration — computes the gravitational acceleration vector
    • state_derivative      — derivative function compatible with SciPy's
                              solve_ivp (state = [x, y, z, vx, vy, vz])
"""

from __future__ import annotations

import logging

import numpy as np
from numpy.typing import NDArray

from core.constants import MU_EARTH, R_EARTH

logger = logging.getLogger(__name__)


def two_body_acceleration(
    position: NDArray[np.float64],
    mu: float = MU_EARTH,
) -> NDArray[np.float64]:
    """Compute gravitational acceleration under the two-body assumption.

    Parameters
    ----------
    position : (3,) array
        Cartesian position vector [x, y, z] in **metres**, measured from
        the centre of the primary body.
    mu : float, optional
        Gravitational parameter of the primary body [m³ s⁻²].
        Defaults to Earth's μ.

    Returns
    -------
    acceleration : (3,) array
        Gravitational acceleration vector [ax, ay, az] in m s⁻².

    Raises
    ------
    ValueError
        If the position vector has zero magnitude (singularity at the
        centre of the primary body), or contains NaN / Inf.

    Notes
    -----
    The expression  a = -μ r / |r|³  is equivalent to  a = -μ r̂ / |r|²
    but avoids a separate unit-vector computation.
    """
    r = np.asarray(position, dtype=np.float64)

    # ── Finite check ────────────────────────────────────────────────
    if not np.all(np.isfinite(r)):
        raise ValueError(
            f"Position vector contains non-finite values: {r}. "
            "This may indicate numerical divergence in the integrator."
        )

    r_mag = np.linalg.norm(r)

    # ── Zero-magnitude singularity ──────────────────────────────────
    if r_mag == 0.0:
        raise ValueError(
            "Position vector has zero magnitude; gravitational acceleration "
            "is undefined at the centre of the primary body."
        )

    # ── Sub-surface warning (inside Earth) ──────────────────────────
    if r_mag < R_EARTH:
        logger.warning(
            "Position magnitude %.2f m is below Earth's radius (%.0f m). "
            "The satellite is inside the Earth — results are non-physical.",
            r_mag,
            R_EARTH,
        )

    return -mu * r / r_mag**3


def state_derivative(
    t: float,  # noqa: ARG001 — required by solve_ivp signature
    state: NDArray[np.float64],
    mu: float = MU_EARTH,
) -> NDArray[np.float64]:
    """Compute the time-derivative of the orbital state vector.

    This function is designed to be passed directly to
    ``scipy.integrate.solve_ivp`` as the right-hand-side function.

    State vector layout::

        state = [x, y, z, vx, vy, vz]
                 ───────  ──────────
                 position  velocity

    The derivative is::

        d(state)/dt = [vx, vy, vz, ax, ay, az]

    Parameters
    ----------
    t : float
        Current epoch (unused in the unperturbed two-body problem, but
        required by the ODE solver interface).
    state : (6,) array
        Concatenated position and velocity vectors [m, m/s].
    mu : float, optional
        Gravitational parameter [m³ s⁻²].

    Returns
    -------
    derivative : (6,) array
        Time-derivative of the state vector.
    """
    position = state[:3]
    velocity = state[3:]
    acceleration = two_body_acceleration(position, mu)
    return np.concatenate([velocity, acceleration])
