"""
Response schemas for the health-check endpoint.

Keeping response models separate from route handlers ensures the API contract
is explicit and reusable across tests, docs, and client generation.
"""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Schema returned by GET /health."""

    status: str
