"""
Aerospace Mission Design & Simulation Platform — API entry point.

Run with:
    uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import time
import logging

from core.config import settings
from routers import health, orbit, ws_orbit

# ── Logging setup ────────────────────────────────────────────────
logger = logging.getLogger("api")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)-8s %(name)s: %(message)s"))
    logger.addHandler(handler)

# ── Application factory ─────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.API_VERSION,
    debug=settings.DEBUG,
)

# ── Middleware ───────────────────────────────────────────────────
@app.middleware("http")
async def log_requests_and_process_time(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    logger.info(
        f"{request.method} {request.url.path} - Status: {response.status_code} - "
        f"Completed in {process_time:.4f}s"
    )
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────
# Register each feature router here. As the platform grows, add new
# routers for missions, simulations, telemetry, etc.
app.include_router(health.router)
app.include_router(orbit.router)
app.include_router(ws_orbit.router)
