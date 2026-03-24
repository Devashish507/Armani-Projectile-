"""
Orbit propagator — numerical integration of the two-body equations of motion.

Uses ``scipy.integrate.solve_ivp`` with an explicit Runge-Kutta method
(default: RK45 / Dormand-Prince) to advance the orbital state vector
through time.

Tight tolerances are used by default to preserve energy conservation over
multi-orbit simulations.  The integrator output is evaluated on a uniform
time grid via the *dense output* mechanism so that the returned arrays have
a predictable, even spacing suitable for downstream analysis and plotting.

All inputs and outputs are in **SI units** (metres, m/s, seconds).
"""

from __future__ import annotations

import logging

import numpy as np
from numpy.typing import NDArray
from scipy.integrate import solve_ivp

from core.constants import MU_EARTH, SUPPORTED_METHODS
from services.orbit.equations import state_derivative
from services.orbit.state import PropagationResult, StateVector
from services.orbit.utils import specific_orbital_energy

logger = logging.getLogger(__name__)


def propagate_orbit(
    initial_position: NDArray[np.float64] | None = None,
    initial_velocity: NDArray[np.float64] | None = None,
    time_span: float = 0.0,
    time_step: float = 0.0,
    mu: float = MU_EARTH,
    method: str = "RK45",
    rtol: float = 1e-10,
    atol: float = 1e-12,
    *,
    state: StateVector | None = None,
) -> PropagationResult:
    """Propagate an orbit from initial conditions over a given time span.

    Accepts either raw arrays **or** a pre-validated :class:`StateVector`.
    When ``state`` is provided, ``initial_position`` and
    ``initial_velocity`` are ignored.

    Parameters
    ----------
    initial_position : (3,) array, optional
        Initial Cartesian position [x, y, z] in **metres**.
    initial_velocity : (3,) array, optional
        Initial Cartesian velocity [vx, vy, vz] in **m/s**.
    time_span : float
        Total propagation duration in **seconds**. Must be > 0.
    time_step : float
        Desired output sample interval in **seconds**.  The integrator
        uses adaptive stepping internally; this only controls the
        returned grid. Must be > 0 and ≤ ``time_span``.
    mu : float, optional
        Gravitational parameter of the central body [m³ s⁻²].
    method : str, optional
        Integration method forwarded to ``solve_ivp``.  Must be one of:
        ``RK45`` (default), ``RK23``, ``DOP853``, ``Radau``, ``BDF``,
        ``LSODA``.
    rtol, atol : float, optional
        Relative and absolute tolerances for the ODE solver.
    state : StateVector, optional
        Pre-validated initial state.  Takes precedence over raw arrays.

    Returns
    -------
    PropagationResult
        Typed result containing time, position, velocity arrays and
        diagnostic metadata (energy, solver evaluations, etc.).

    Raises
    ------
    ValueError
        If inputs are missing, have invalid shapes, or fail unit checks.
    RuntimeError
        If the ODE solver fails to converge.

    Examples
    --------
    Using raw arrays (backwards-compatible):

    >>> import numpy as np
    >>> r0 = np.array([7_000_000.0, 0.0, 0.0])
    >>> v0 = np.array([0.0, 7_546.0, 0.0])
    >>> result = propagate_orbit(r0, v0, time_span=5400.0, time_step=10.0)
    >>> result.position.shape
    (541, 3)

    Using a StateVector:

    >>> sv = StateVector.from_arrays(r0, v0)
    >>> result = propagate_orbit(state=sv, time_span=5400.0, time_step=10.0)
    """

    # ── Build / validate StateVector ────────────────────────────────
    if state is not None:
        sv = state
    elif initial_position is not None and initial_velocity is not None:
        sv = StateVector.from_arrays(initial_position, initial_velocity)
    else:
        raise ValueError(
            "Provide either (initial_position, initial_velocity) or a "
            "StateVector via the 'state' keyword argument."
        )

    # ── Parameter validation ────────────────────────────────────────
    if time_span <= 0:
        raise ValueError(f"time_span must be positive, got {time_span}")
    if time_step <= 0:
        raise ValueError(f"time_step must be positive, got {time_step}")
    if time_step > time_span:
        raise ValueError(
            f"time_step ({time_step}) cannot exceed time_span ({time_span})"
        )
    if method not in SUPPORTED_METHODS:
        raise ValueError(
            f"Unsupported integration method '{method}'. "
            f"Choose from: {', '.join(SUPPORTED_METHODS)}"
        )

    # ── Pre-propagation diagnostics ─────────────────────────────────
    energy_0 = specific_orbital_energy(sv.position, sv.velocity, mu)

    if energy_0 >= 0:
        logger.warning(
            "Specific orbital energy is %.4f J/kg (non-negative). "
            "This is an escape / hyperbolic trajectory — the satellite "
            "will not return to its starting position.",
            energy_0,
        )

    logger.info(
        "Propagation start — method=%s, t_span=%.2f s, dt=%.2f s, "
        "r0=%.2f km, v0=%.4f km/s, ε₀=%.4f J/kg",
        method,
        time_span,
        time_step,
        float(np.linalg.norm(sv.position)) / 1e3,
        float(np.linalg.norm(sv.velocity)) / 1e3,
        energy_0,
    )

    # ── Integrate ───────────────────────────────────────────────────
    state0 = sv.to_flat()

    # Uniform evaluation grid — linspace avoids floating-point overshoot
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
    positions = states[:, :3]
    velocities = states[:, 3:]

    # ── Post-propagation diagnostics ────────────────────────────────
    energy_f = specific_orbital_energy(positions[-1], velocities[-1], mu)

    drift_pct = (
        abs(energy_f - energy_0) / abs(energy_0) * 100
        if energy_0 != 0 else 0.0
    )

    logger.info(
        "Propagation complete — %d steps, %d RHS evaluations, "
        "ε_final=%.4f J/kg, energy drift=%.2e %%",
        len(solution.t),
        solution.nfev,
        energy_f,
        drift_pct,
    )

    if drift_pct > 1e-4:
        logger.warning(
            "Energy drift %.2e%% exceeds recommended threshold (1e-4%%). "
            "Consider tightening rtol/atol or using a higher-order method "
            "(e.g. DOP853).",
            drift_pct,
        )

    return PropagationResult(
        time=solution.t,
        position=positions,
        velocity=velocities,
        initial_state=sv,
        method=method,
        energy_initial=energy_0,
        energy_final=energy_f,
        solver_evaluations=solution.nfev,
    )
