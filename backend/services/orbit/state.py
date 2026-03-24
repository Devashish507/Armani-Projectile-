"""
Orbital state vector and propagation result data structures.

Provides immutable, validated containers for the 6-D orbital state
(position + velocity) and for the output of a propagation run.

All inputs and outputs use **SI units** (metres, m/s, seconds).
Validation guards catch common mistakes such as passing kilometres
instead of metres, or exceeding physically plausible velocities.

Unit conventions
----------------
    position  →  metres      (|r| must be > 1e5 m, i.e. > 100 km)
    velocity  →  m / s       (|v| must be < 1e6 m/s)
    epoch     →  seconds     (offset from a reference — 0.0 if unspecified)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

logger = logging.getLogger(__name__)

# ── Validation thresholds ───────────────────────────────────────────
_MIN_POSITION_MAGNITUDE: float = 1e5       # 100 km  — anything less is inside Earth
_MAX_VELOCITY_MAGNITUDE: float = 1e6       # 1 000 km/s — well beyond any bound orbit


@dataclass(frozen=True)
class StateVector:
    """Immutable 6-D orbital state snapshot.

    Attributes
    ----------
    position : (3,) float64 array
        Cartesian position [x, y, z] in **metres**.
    velocity : (3,) float64 array
        Cartesian velocity [vx, vy, vz] in **m/s**.
    epoch : float
        Reference time in seconds (e.g. seconds since J2000).
        Set to ``0.0`` when epoch is not meaningful.
    """

    position: NDArray[np.float64]
    velocity: NDArray[np.float64]
    epoch: float = 0.0

    # ── Factories ───────────────────────────────────────────────────

    @classmethod
    def from_arrays(
        cls,
        position: NDArray[np.float64],
        velocity: NDArray[np.float64],
        epoch: float = 0.0,
    ) -> StateVector:
        """Create a validated ``StateVector`` from position and velocity arrays.

        Parameters
        ----------
        position : array-like, shape (3,)
            Cartesian position in **metres**.
        velocity : array-like, shape (3,)
            Cartesian velocity in **m/s**.
        epoch : float, optional
            Reference epoch in seconds.

        Returns
        -------
        StateVector

        Raises
        ------
        ValueError
            If arrays have wrong shape, contain NaN/Inf, or fail the
            SI-unit plausibility checks.
        """
        r = np.asarray(position, dtype=np.float64)
        v = np.asarray(velocity, dtype=np.float64)

        # ── Shape checks ────────────────────────────────────────────
        if r.shape != (3,):
            raise ValueError(
                f"Position must be a 3-element vector, got shape {r.shape}"
            )
        if v.shape != (3,):
            raise ValueError(
                f"Velocity must be a 3-element vector, got shape {v.shape}"
            )

        # ── Finite checks (NaN / Inf) ───────────────────────────────
        if not np.all(np.isfinite(r)):
            raise ValueError(
                f"Position contains non-finite values: {r}"
            )
        if not np.all(np.isfinite(v)):
            raise ValueError(
                f"Velocity contains non-finite values: {v}"
            )

        # ── SI-unit plausibility ────────────────────────────────────
        r_mag = float(np.linalg.norm(r))
        v_mag = float(np.linalg.norm(v))

        if r_mag < _MIN_POSITION_MAGNITUDE:
            raise ValueError(
                f"Position magnitude {r_mag:.2f} m is below the minimum "
                f"threshold ({_MIN_POSITION_MAGNITUDE:.0f} m). "
                f"Ensure position is in METRES, not kilometres."
            )
        if v_mag > _MAX_VELOCITY_MAGNITUDE:
            raise ValueError(
                f"Velocity magnitude {v_mag:.2f} m/s exceeds the maximum "
                f"threshold ({_MAX_VELOCITY_MAGNITUDE:.0f} m/s). "
                f"Ensure velocity is in M/S, not km/s."
            )

        return cls(position=r, velocity=v, epoch=epoch)

    # ── Conversions ─────────────────────────────────────────────────

    def to_flat(self) -> NDArray[np.float64]:
        """Flatten to a 6-element array ``[x, y, z, vx, vy, vz]``.

        This is the layout expected by SciPy's ODE solvers.
        """
        return np.concatenate([self.position, self.velocity])

    @classmethod
    def from_flat(
        cls,
        flat: NDArray[np.float64],
        epoch: float = 0.0,
    ) -> StateVector:
        """Reconstruct from a 6-element flat array (no SI validation).

        Intended for internal use by the integrator, where values have
        already been validated at propagation start.
        """
        return cls(
            position=flat[:3].copy(),
            velocity=flat[3:].copy(),
            epoch=epoch,
        )

    # ── Display ─────────────────────────────────────────────────────

    def __repr__(self) -> str:
        r_km = self.position / 1e3
        v_kms = self.velocity / 1e3
        return (
            f"StateVector("
            f"r=[{r_km[0]:+.3f}, {r_km[1]:+.3f}, {r_km[2]:+.3f}] km, "
            f"v=[{v_kms[0]:+.6f}, {v_kms[1]:+.6f}, {v_kms[2]:+.6f}] km/s, "
            f"epoch={self.epoch:.3f} s)"
        )


@dataclass(frozen=True)
class PropagationResult:
    """Structured output from an orbit propagation run.

    Attributes
    ----------
    time : (N,) float64 array
        Epoch values in seconds from propagation start.
    position : (N, 3) float64 array
        Cartesian position vectors [m] at each epoch.
    velocity : (N, 3) float64 array
        Cartesian velocity vectors [m/s] at each epoch.
    initial_state : StateVector
        The validated initial state that seeded the propagation.
    method : str
        Integration method used (e.g. ``"RK45"``).
    energy_initial : float
        Specific orbital energy at t=0 [J/kg].
    energy_final : float
        Specific orbital energy at the last epoch [J/kg].
    solver_evaluations : int
        Number of right-hand-side function evaluations.
    """

    time: NDArray[np.float64]
    position: NDArray[np.float64]
    velocity: NDArray[np.float64]
    initial_state: StateVector
    method: str
    energy_initial: float
    energy_final: float
    solver_evaluations: int

    @property
    def energy_drift_pct(self) -> float:
        """Relative energy drift over the propagation [%]."""
        if self.energy_initial == 0.0:
            return 0.0
        return abs(self.energy_final - self.energy_initial) / abs(self.energy_initial) * 100

    @property
    def n_steps(self) -> int:
        """Number of output time steps."""
        return len(self.time)

    def to_dict(self) -> dict:
        """Serialize to a plain dictionary (JSON-friendly shapes).

        Matches the original output format for backwards compatibility.
        """
        return {
            "time": self.time,
            "position": self.position,
            "velocity": self.velocity,
        }
