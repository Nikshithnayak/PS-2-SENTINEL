from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from sim.generator import SCENARIO_CATALOG, ScenarioName, generate_scenario

CONTRACTS_PATH = Path(__file__).resolve().parents[3] / "packages" / "shared" / "contracts" / "sentinel-contracts.json"

app = FastAPI(
    title="SENTINEL Detection Engine",
    version="0.2.0",
    description="Deterministic, auditable personal baseline and 3-layer physiological anomaly detection engine.",
)


class SimGenerateRequest(BaseModel):
    scenario: ScenarioName = "early_infection"
    seed: int = Field(default=42, ge=0, le=1_000_000)
    total_days: int = Field(default=18, ge=3, le=60)
    base_rhr: float = Field(default=64.0, ge=35.0, le=120.0)
    base_hrv: float = Field(default=34.0, ge=5.0, le=180.0)
    base_spo2: float = Field(default=97.0, ge=82.0, le=100.0)
    base_rr: float = Field(default=15.0, ge=8.0, le=35.0)


def load_shared_contracts() -> dict[str, Any]:
    if CONTRACTS_PATH.exists():
        return json.loads(CONTRACTS_PATH.read_text(encoding="utf-8"))
    return {"version": "fallback", "enums": {}}


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "sentinel-engine",
        "version": app.version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/readyz")
async def readyz() -> JSONResponse:
    db_url = os.getenv("DATABASE_URL")
    contracts = load_shared_contracts()
    return JSONResponse(
        status_code=200,
        content={
            "status": "ready",
            "service": "sentinel-engine",
            "contractsVersion": contracts.get("version"),
            "databaseConfigured": bool(db_url),
            "autoencoderEnabled": os.getenv("ENABLE_AUTOENCODER_L3", "false").lower() == "true",
        },
    )


@app.get("/v1/sim/scenarios")
async def list_scenarios() -> dict[str, Any]:
    return {"scenarios": SCENARIO_CATALOG}


@app.post("/v1/sim/generate")
async def generate_sim_endpoint(req: SimGenerateRequest) -> dict[str, Any]:
    res = generate_scenario(
        scenario=req.scenario,
        seed=req.seed,
        total_days=req.total_days,
        base_rhr=req.base_rhr,
        base_hrv=req.base_hrv,
        base_spo2=req.base_spo2,
        base_rr=req.base_rr,
    )
    return {
        "scenario": res.scenario,
        "seed": res.seed,
        "totalDays": res.total_days,
        "onsetAt": res.onset_at,
        "description": res.description,
        "expectedAlertLevel": res.expected_alert_level,
        "isSynthetic": True,
        "sampleCount": len(res.samples),
        "samples": res.samples,
    }
