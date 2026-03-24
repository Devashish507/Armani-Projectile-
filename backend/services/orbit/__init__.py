"""
Orbit service — two-body orbital propagation.

Public API:
    from services.orbit import propagate_orbit
"""

from services.orbit.propagator import propagate_orbit

__all__ = ["propagate_orbit"]
