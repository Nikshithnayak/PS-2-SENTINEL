from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

CONTRACTS_PATH = Path(__file__).resolve().parents[3] / "packages" / "shared" / "contracts" / "sentinel-contracts.json"

app = FastAPI(
    title="SENTINEL Detection Engine",
    version="0.1.0",
    description="Deterministic, auditable personal baseline and 3-layer physiological anomaly detection engine.",
)


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
