"""
Utility helpers for orbital mechanics calculations.

These are thin, reusable functions that operate on NumPy arrays and return
scalar or array quantities commonly needed in orbit analysis.

All functions expect **SI units** (metres, m/s, m³ s⁻²).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from core.constants import MU_EARTH


def vector_magnitude(v: NDArray[np.float64]) -> float:
    """Return the Euclidean (L2) norm of a vector.

    Parameters
    ----------
    v : (N,) array
        Input vector.

    Returns
    -------
    float
        ||v||₂
    """
    return float(np.linalg.norm(v))


def orbital_radius(position: NDArray[np.float64]) -> float:
    """Return the orbital radius (distance from the primary body centre).

    Parameters
    ----------
    position : (3,) array
        Cartesian position vector [m].

    Returns
    -------
    float
        Scalar distance [m].

    Notes
    -----
    Semantically identical to :func:`vector_magnitude` but named for
    clarity when used in orbital-mechanics context.
    """
    return vector_magnitude(position)


def specific_orbital_energy(
    position: NDArray[np.float64],
    velocity: NDArray[np.float64],
    mu: float = MU_EARTH,
) -> float:
    """Compute the specific mechanical energy (vis-viva) of an orbit.

    The specific orbital energy is a conserved quantity in the unperturbed
    two-body problem:

        ε = v² / 2  −  μ / r

    where
        v = speed (magnitude of velocity vector)  [m/s]
        r = orbital radius                        [m]
        μ = gravitational parameter               [m³ s⁻²]

    A negative ε indicates a bound (elliptical) orbit; zero is parabolic;
    positive is hyperbolic.

    Parameters
    ----------
    position : (3,) array
        Cartesian position vector [m].
    velocity : (3,) array
        Cartesian velocity vector [m/s].
    mu : float, optional
        Gravitational parameter [m³ s⁻²].

    Returns
    -------
    float
        Specific orbital energy [J/kg] (equivalently m² s⁻²).
    """
    r = vector_magnitude(position)
    v = vector_magnitude(velocity)
    return 0.5 * v**2 - mu / r


def escape_velocity(position: NDArray[np.float64], mu: float = MU_EARTH) -> float:
    """Compute the local escape velocity at a given position.

    The escape velocity is the minimum speed required for an object to
    escape the gravitational influence of the primary body:

        v_esc = √(2μ / r)

    Parameters
    ----------
    position : (3,) array
        Cartesian position vector [m].
    mu : float, optional
        Gravitational parameter [m³ s⁻²].

    Returns
    -------
    float
        Escape velocity [m/s].
    """
    r = vector_magnitude(position)
    return float(np.sqrt(2.0 * mu / r))


def circular_velocity(position: NDArray[np.float64], mu: float = MU_EARTH) -> float:
    """Compute the circular orbital velocity at a given radius.

    For a circular orbit:  v_circ = √(μ / r)

    Parameters
    ----------
    position : (3,) array
        Cartesian position vector [m].
    mu : float, optional
        Gravitational parameter [m³ s⁻²].

    Returns
    -------
    float
        Circular velocity [m/s].
    """
    r = vector_magnitude(position)
    return float(np.sqrt(mu / r))


def orbital_period(radius: float, mu: float = MU_EARTH) -> float:
    """Compute the Keplerian orbital period for a circular orbit.

    T = 2π √(r³ / μ)

    Parameters
    ----------
    radius : float
        Orbital radius [m].
    mu : float, optional
        Gravitational parameter [m³ s⁻²].

    Returns
    -------
    float
        Orbital period [s].
    """
    return 2.0 * np.pi * np.sqrt(radius**3 / mu)
