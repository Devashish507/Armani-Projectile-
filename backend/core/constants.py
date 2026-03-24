"""
Physical constants for orbital mechanics simulations.

All values are in SI units (metres, kilograms, seconds) and sourced from
standard astrodynamic references.  Import individual constants as needed
rather than using star-imports so that the origin of each value is traceable.
"""

# ── Earth Parameters ────────────────────────────────────────────────
# Standard gravitational parameter  μ = G·M  [m³ s⁻²]
# Source: IERS 2010 Conventions / EGM2008
MU_EARTH: float = 3.986004418e14

# Mean volumetric radius  [m]
R_EARTH: float = 6.371e6

# ── Reference Epochs ────────────────────────────────────────────────
# J2000.0 epoch — the standard astronomical reference
J2000_EPOCH_ISO: str = "2000-01-01T12:00:00Z"

# ── Supported ODE Solvers ───────────────────────────────────────────
# Subset of scipy.integrate.solve_ivp methods suitable for orbital mechanics
SUPPORTED_METHODS: tuple[str, ...] = ("RK45", "RK23", "DOP853", "Radau", "BDF", "LSODA")
