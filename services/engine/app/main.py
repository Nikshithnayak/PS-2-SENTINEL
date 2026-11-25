from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from engine.baseline import fit_personal_baselines
from engine.datasets.loaders import DATASET_CATALOG
from engine.detectors import evaluate_patient_window
from engine.eval_harness import run_benchmark
from engine.features import aggregate_hourly_timeline, normalize_samples, parse_exclusions
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


class EngineEvaluateRequest(BaseModel):
    patientId: str = Field(min_length=1)
    samples: list[dict[str, Any]]
    conditions: list[str] = Field(default_factory=lambda: ["general_frailty"])
    age: int | None = Field(default=72, ge=1, le=120)
    exclusions: list[dict[str, Any]] = Field(default_factory=list)
    environment: dict[str, Any] | None = None
    referenceNow: str | None = None


class BenchmarkRequest(BaseModel):
    seeds: list[int] = Field(default_factory=lambda: [42, 43])
    totalDays: int = Field(default=18, ge=10, le=30)
    includeAblations: bool = True


@app.post("/v1/baseline/fit")
async def fit_baseline_endpoint(req: EngineEvaluateRequest) -> dict[str, Any]:
    samples = normalize_samples(req.samples)
    spans = parse_exclusions(req.exclusions)
    buckets = aggregate_hourly_timeline(samples, spans)
    model = fit_personal_baselines(
        patient_id=req.patientId,
        buckets=buckets,
        conditions=req.conditions,
        age=req.age,
    )
    return model.to_dict()


@app.post("/v1/score/evaluate")
async def evaluate_score_endpoint(req: EngineEvaluateRequest) -> dict[str, Any]:
    from engine.features import parse_utc

    ref_dt = parse_utc(req.referenceNow) if req.referenceNow else None
    return evaluate_patient_window(
        patient_id=req.patientId,
        raw_samples=req.samples,
        conditions=req.conditions,
        age=req.age,
        exclusions=req.exclusions,
        environment=req.environment,
        reference_now=ref_dt,
    )


@app.post("/v1/eval/benchmark")
async def benchmark_endpoint(req: BenchmarkRequest) -> dict[str, Any]:
    return run_benchmark(
        seeds=req.seeds,
        total_days=req.totalDays,
        include_ablations=req.includeAblations,
    )


@app.get("/v1/datasets")
async def list_datasets_endpoint() -> dict[str, Any]:
    return {"datasets": DATASET_CATALOG}
