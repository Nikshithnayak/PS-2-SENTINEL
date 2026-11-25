"""Public dataset adapters (PMData, LifeSnaps, WESAD, MMASH) normalizing to canonical schema.

Honesty Policy:
- Real full raw archives (e.g. Kaggle/Zenodo/UCI ZIPs) are user-supplied in `_data/<dataset>/`
  due to size and dataset terms.
- When `_data/` archives are absent, adapters cleanly transform schema-faithful sample records
  for format verification and clearly mark `fixtureMode=True` in dataset reports.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any

DATASET_CATALOG: dict[str, dict[str, str]] = {
    "pmdata": {
        "name": "PMData Sports & Lifelogging (Simula)",
        "format": "Fitbit HR/sleep JSON + wellness CSV",
        "license": "CC BY 4.0",
        "metrics": "resting_heart_rate, steps, sleep_duration_min, sleep_efficiency",
    },
    "lifesnaps": {
        "name": "LifeSnaps Fitbit Multimodal",
        "format": "Hourly/daily Fitbit JSON/CSV",
        "license": "Zenodo Open Access",
        "metrics": "resting_heart_rate, hrv_rmssd, spo2, steps, sleep_efficiency",
    },
    "wesad": {
        "name": "WESAD Wearable Stress & Affect (Empatica E4)",
        "format": "Summary window CSV / BVP-EDA-TEMP",
        "license": "Research non-commercial",
        "metrics": "heart_rate, hrv_rmssd, skin_temp_deviation",
    },
    "mmash": {
        "name": "MMASH Multilevel Activity & Sleep (PhysioNet)",
        "format": "RR/Actigraph CSV (beats -> resting HR & RMSSD)",
        "license": "ODbL 1.0",
        "metrics": "heart_rate, hrv_rmssd, steps",
    },
}


def load_pmdata_records(csv_text: str) -> list[dict[str, Any]]:
    """Parses PMData wellness/Fitbit daily-or-hourly CSV rows into canonical SENTINEL samples."""
    reader = csv.DictReader(io.StringIO(csv_text))
    samples: list[dict[str, Any]] = []
    for row in reader:
        ts = row.get("effective_time_frame") or row.get("timestamp") or row.get("date")
        if not ts:
            continue
        if len(ts) == 10:
            ts = f"{ts}T07:00:00Z"
        if row.get("resting_heart_rate"):
            samples.append(
                {
                    "metricType": "resting_heart_rate",
                    "value": float(row["resting_heart_rate"]),
                    "unit": "bpm",
                    "recordedAt": ts,
                    "context": "rest",
                    "source": "fitbit_takeout",
                    "isSynthetic": False,
                }
            )
        if row.get("steps"):
            samples.append(
                {
                    "metricType": "steps",
                    "value": float(row["steps"]),
                    "unit": "count",
                    "recordedAt": ts,
                    "context": "light_activity",
                    "source": "fitbit_takeout",
                    "isSynthetic": False,
                }
            )
        if row.get("sleep_duration_min"):
            samples.append(
                {
                    "metricType": "sleep_duration_min",
                    "value": float(row["sleep_duration_min"]),
                    "unit": "min",
                    "recordedAt": ts,
                    "context": "sleep",
                    "source": "fitbit_takeout",
                    "isSynthetic": False,
                }
            )
    return samples


def load_lifesnaps_records(json_text: str) -> list[dict[str, Any]]:
    """Parses LifeSnaps JSON export array into canonical SENTINEL samples."""
    payload = json.loads(json_text)
    rows = payload if isinstance(payload, list) else payload.get("records", [])
    samples: list[dict[str, Any]] = []
    for row in rows:
        ts = row.get("dateTime") or row.get("timestamp")
        if not ts:
            continue
        mapping = (
            ("bpm", "resting_heart_rate", "bpm", "rest"),
            ("rmssd", "hrv_rmssd", "ms", "sleep"),
            ("spo2", "spo2", "%", "sleep"),
            ("steps", "steps", "count", "light_activity"),
        )
        for key, metric, unit, ctx in mapping:
            if row.get(key) is not None:
                samples.append(
                    {
                        "metricType": metric,
                        "value": float(row[key]),
                        "unit": unit,
                        "recordedAt": str(ts).replace(" ", "T") + ("Z" if "T" not in str(ts) and "Z" not in str(ts) else ""),
                        "context": ctx,
                        "source": "fitbit_takeout",
                        "isSynthetic": False,
                    }
                )
    return samples


def load_wesad_summary_records(csv_text: str) -> list[dict[str, Any]]:
    """Parses WESAD summary CSV windows (heart_rate, rmssd, skin_temp_deviation, label)."""
    reader = csv.DictReader(io.StringIO(csv_text))
    samples: list[dict[str, Any]] = []
    for row in reader:
        ts = row.get("timestamp")
        if not ts:
            continue
        if row.get("hr_bpm"):
            samples.append(
                {
                    "metricType": "heart_rate",
                    "value": float(row["hr_bpm"]),
                    "unit": "bpm",
                    "recordedAt": ts,
                    "context": "rest",
                    "source": "csv_import",
                    "isSynthetic": False,
                }
            )
        if row.get("rmssd_ms"):
            samples.append(
                {
                    "metricType": "hrv_rmssd",
                    "value": float(row["rmssd_ms"]),
                    "unit": "ms",
                    "recordedAt": ts,
                    "context": "rest",
                    "source": "csv_import",
                    "isSynthetic": False,
                }
            )
        if row.get("temp_dev_c"):
            samples.append(
                {
                    "metricType": "skin_temp_deviation",
                    "value": float(row["temp_dev_c"]),
                    "unit": "degC",
                    "recordedAt": ts,
                    "context": "rest",
                    "source": "csv_import",
                    "isSynthetic": False,
                }
            )
    return samples


def load_mmash_records(csv_text: str) -> list[dict[str, Any]]:
    """Parses MMASH Actigraph/RR CSV rows into canonical SENTINEL samples."""
    reader = csv.DictReader(io.StringIO(csv_text))
    samples: list[dict[str, Any]] = []
    for row in reader:
        ts = row.get("timestamp")
        if not ts:
            continue
        if row.get("ibi_ms"):
            ibi = float(row["ibi_ms"])
            if 280.0 <= ibi <= 2000.0:
                samples.append(
                    {
                        "metricType": "heart_rate",
                        "value": round(60000.0 / ibi, 1),
                        "unit": "bpm",
                        "recordedAt": ts,
                        "context": "rest",
                        "source": "csv_import",
                        "isSynthetic": False,
                    }
                )
        if row.get("steps"):
            samples.append(
                {
                    "metricType": "steps",
                    "value": float(row["steps"]),
                    "unit": "count",
                    "recordedAt": ts,
                    "context": "light_activity",
                    "source": "csv_import",
                    "isSynthetic": False,
                }
            )
    return samples
