"""
stats-service — FastAPI entry point.

Endpoints:
  GET  /health                     liveness probe
  POST /api/analyze/{run_id}       force re-analyze one ExperimentRun
  GET  /api/results/{run_id}       return latest analysisResult for a run

Periodic analysis:
  Every ANALYSIS_INTERVAL_SECONDS (default 600) all running ExperimentRuns are
  re-analyzed and their results written to PostgreSQL.
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

load_dotenv()

from analysis import analyze_all_running, analyze_run
from db import get_run_by_id

INTERVAL = int(os.environ.get("ANALYSIS_INTERVAL_SECONDS", "600"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger(__name__)


# ── Periodic background loop ───────────────────────────────────────────────────

async def _periodic_loop() -> None:
    while True:
        try:
            await asyncio.get_event_loop().run_in_executor(None, analyze_all_running)
        except Exception as exc:
            log.error("Periodic analysis failed: %s", exc, exc_info=True)
        await asyncio.sleep(INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_periodic_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(title="stats-service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze/{run_id}")
def force_analyze(run_id: str):
    """Trigger immediate re-analysis of a single ExperimentRun (any status)."""
    run = get_run_by_id(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="ExperimentRun not found")
    if not run.get("env_id") or not run.get("flag_key") or not run.get("primary_metric_event"):
        raise HTTPException(status_code=422, detail="Run is missing env_id / flag_key / primary_metric_event")
    result = analyze_run(run)
    return {"run_id": run_id, "computed_at": result.get("computed_at"), "error": result.get("error")}


@app.get("/api/results/{run_id}")
def get_results(run_id: str):
    """Return the latest analysisResult for an ExperimentRun."""
    run = get_run_by_id(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="ExperimentRun not found")
    raw = run.get("analysis_result")
    if not raw:
        raise HTTPException(status_code=404, detail="No analysis result yet for this run")
    return json.loads(raw) if isinstance(raw, str) else raw
