# Performance & Scalability Roadmap

## Current Architecture

The propagator is **single-satellite, sequential** — one call to
`propagate_orbit()` integrates one trajectory on a single CPU core.

For the two-body problem with SciPy's RK45 this is more than adequate:
a full LEO orbit (≈ 5 800 s at 10 s steps) completes in < 50 ms on
modern hardware.

## When to Optimise

| Scenario | Bottleneck | Recommended Path |
|---|---|---|
| 1–10 satellites, short arcs | None | Current architecture works |
| 10–100 satellites | Python loop overhead | `concurrent.futures` thread pool |
| 100–10 000 satellites | Function-call overhead in `two_body_acceleration` | **Numba JIT** on `state_derivative` |
| Real-time / Monte-Carlo | Integrator overhead | Batch-vectorised propagator (all states in one array) or compiled solver (C/Fortran via ctypes) |
| High-fidelity (perturbations, drag) | Physics model complexity | Precomputed force look-up tables, GPU acceleration |

## Numba JIT Example (Future)

```python
from numba import njit

@njit(cache=True)
def two_body_acceleration_jit(rx, ry, rz, mu):
    r_mag = (rx**2 + ry**2 + rz**2) ** 0.5
    factor = -mu / r_mag**3
    return factor * rx, factor * ry, factor * rz
```

This eliminates NumPy overhead and enables the solver to call scalar
functions directly — typically **10–50× faster** for single-satellite
propagation.

## Batch Propagation (Future)

For many satellites with identical force models, stack all state vectors
into a `(6N,)` array and integrate them in a single `solve_ivp` call.
This amortises Python ↔ C boundary crossings.
