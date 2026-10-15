import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.api import router, ensure_coverage_runs

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seeding never runs if the user cleared history (demo_seed_declined=true)
    try:
        from app.db import db_manager
        if db_manager.get_setting("demo_seed_declined") != "true" and db_manager.count_runs() == 0:
            ensure_coverage_runs()
    except Exception as e:
        logger.warning(f"Startup coverage seeding error: {e}")
    yield


app = FastAPI(
    title="AgentProbe API",
    description="Full-stack platform for stress-testing tool-using AI agents with controlled fault injection, minimal-set shrinking, and measured auto-hardening.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Configure CORS
cors_origins_env = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register versioned API router
app.include_router(router)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")
