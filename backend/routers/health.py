"""
Health-check router.

Provides a lightweight endpoint for monitoring and frontend connectivity checks.
Add additional diagnostic info here as the platform grows (DB status, queue depth, etc.).
"""

from fastapi import APIRouter

from models.health import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Return a simple status payload confirming the API is reachable."""
    return HealthResponse(status="ok")
