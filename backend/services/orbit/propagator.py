"""
Orbit propagator — numerical integration of the two-body equations of motion.

Uses ``scipy.integrate.solve_ivp`` with the explicit Runge-Kutta 4(5) method
(Dormand-Prince) to advance the orbital state vector through time.

Tight tolerances are used by default to preserve energy conservation over
multi-orbit simulations.  The integrator output is evaluated on a uniform
time grid via the *dense output* mechanism so that the returned arrays have
a predictable, even spacing suitable for downstream analysis and plotting.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.integrate import solve_ivp

from core.constants import MU_EARTH
from services.orbit.equations import state_derivative


def propagate_orbit(
    initial_position: NDArray[np.float64],
    initial_velocity: NDArray[np.float64],
    time_span: float,
    time_step: float,
    mu: float = MU_EARTH,
    method: str = "RK45",
    rtol: float = 1e-10,
    atol: float = 1e-12,
) -> dict[str, Any]:
    """Propagate an orbit from initial conditions over a given time span.

    Parameters
    ----------
    initial_position : (3,) array
        Initial Cartesian position [x, y, z] in metres.
    initial_velocity : (3,) array
        Initial Cartesian velocity [vx, vy, vz] in m/s.
    time_span : float
        Total propagation duration in seconds.
    time_step : float
        Desired output sample interval in seconds.  The integrator uses
        adaptive stepping internally; this only controls the returned grid.
    mu : float, optional
        Gravitational parameter of the central body [m³ s⁻²].
    method : str, optional
        Integration method forwarded to ``solve_ivp`` (default ``"RK45"``).
    rtol, atol : float, optional
        Relative and absolute tolerances for the ODE solver.

    Returns
    -------
    result : dict
        ``"time"``      — 1-D array of epoch values [s]
        ``"position"``  — (N, 3) array of position vectors [m]
        ``"velocity"``  — (N, 3) array of velocity vectors [m/s]

    Raises
    ------
    RuntimeError
        If the ODE solver fails to converge.

    Examples
    --------
    >>> import numpy as np
    >>> r0 = np.array([7_000_000.0, 0.0, 0.0])
    >>> v0 = np.array([0.0, 7_546.0, 0.0])
    >>> result = propagate_orbit(r0, v0, time_span=5400.0, time_step=10.0)
    >>> result["position"].shape
    (541, 3)
    """
    r0 = np.asarray(initial_position, dtype=np.float64)
    v0 = np.asarray(initial_velocity, dtype=np.float64)

    # Combine into a single state vector [x, y, z, vx, vy, vz]
    state0 = np.concatenate([r0, v0])

    # Uniform evaluation grid — from 0 to time_span (inclusive).
    # Use linspace with an integer step count to avoid floating-point
    # overshoot that can push the last value beyond t_span.
    n_steps = int(np.round(time_span / time_step))
    t_eval = np.linspace(0.0, time_span, n_steps + 1)

    solution = solve_ivp(
        fun=lambda t, y: state_derivative(t, y, mu),
        t_span=(0.0, time_span),
        y0=state0,
        method=method,
        t_eval=t_eval,
        rtol=rtol,
        atol=atol,
        dense_output=True,
    )

    if not solution.success:
        raise RuntimeError(
            f"Orbit propagation failed: {solution.message}"
        )

    # solution.y has shape (6, N) — transpose to (N, 6) for row-per-epoch
    states = solution.y.T

    return {
        "time": solution.t,                # (N,)
        "position": states[:, :3],          # (N, 3)
        "velocity": states[:, 3:],          # (N, 3)
    }
