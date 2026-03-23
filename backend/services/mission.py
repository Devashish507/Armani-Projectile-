"""
Mission service — business logic for mission design & simulation.

This module will house the core domain logic, keeping it decoupled from
HTTP concerns (routers) and persistence (models/DB). Examples of future
responsibilities:

  • Orbital trajectory calculations
  • Mission parameter validation & optimization
  • Simulation orchestration
  • Result aggregation & reporting

Import this service into routers; never import routers into services.
"""
