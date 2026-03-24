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
