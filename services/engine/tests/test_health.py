import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def test_healthz_and_readyz() -> None:
    client = TestClient(app)
    h = client.get("/healthz")
    assert h.status_code == 200
    assert h.json()["status"] == "ok"

    r = client.get("/readyz")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"
    assert r.json()["autoencoderEnabled"] is False


def test_shared_contracts_synced() -> None:
    contracts_path = (
        Path(__file__).resolve().parents[3]
        / "packages"
        / "shared"
        / "contracts"
        / "sentinel-contracts.json"
    )
    assert contracts_path.exists(), "Run export:contracts in @sentinel/shared"
    data = json.loads(contracts_path.read_text(encoding="utf-8"))
    assert "resting_heart_rate" in data["enums"]["metricTypes"]
    assert "urgent" in data["enums"]["alertLevels"]
    assert "patient" in data["enums"]["roles"]
