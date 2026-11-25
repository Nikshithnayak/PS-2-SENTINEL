"""Hourly physiological feature aggregation with context & quality separation."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

CORE_VITALS = (
    "resting_heart_rate",
    "heart_rate",
    "hrv_rmssd",
    "spo2",
    "respiratory_rate",
    "skin_temp_deviation",
    "body_temperature",
    "steps",
    "sleep_efficiency",
    "sleep_duration_min",
    "sleep_awakenings",
    "systolic_bp",
    "blood_glucose",
    "weight_kg",
    "afib_burden",
)

# Minimum robust sigma floor per metric prevents narrow low-variance streaks from exploding z-scores.
MIN_SIGMA_FLOOR: dict[str, float] = {
    "resting_heart_rate": 2.5,
    "heart_rate": 4.5,
    "hrv_rmssd": 4.0,
    "spo2": 1.0,
    "respiratory_rate": 1.0,
    "skin_temp_deviation": 0.25,
    "body_temperature": 0.22,
    "steps": 65.0,
    "sleep_efficiency": 4.0,
    "sleep_duration_min": 30.0,
    "sleep_awakenings": 1.0,
    "systolic_bp": 6.5,
    "blood_glucose": 15.0,
    "weight_kg": 0.45,
    "afib_burden": 1.5,
}

# Expected deterioration polarity: +1 means rise is risky, -1 means drop is risky, 0 means bidirectional.
RISK_DIRECTION: dict[str, int] = {
    "resting_heart_rate": 1,
    "heart_rate": 1,
    "hrv_rmssd": -1,
    "spo2": -1,
    "respiratory_rate": 1,
    "skin_temp_deviation": 1,
    "body_temperature": 0,
    "steps": -1,
    "sleep_efficiency": -1,
    "sleep_duration_min": -1,
    "sleep_awakenings": 1,
    "systolic_bp": 0,
    "blood_glucose": 0,
    "weight_kg": 1,
    "afib_burden": 1,
}


@dataclass
class SamplePoint:
    metric_type: str
    value: float
    unit: str
    recorded_at: datetime
    context: str
    confidence: float
    quality_flags: list[str]
    is_synthetic: bool


@dataclass
class HourlyBucket:
    hour_utc: datetime
    circadian_block: str  # night | morning | afternoon | evening
    is_weekend: bool
    metrics: dict[str, float] = field(default_factory=dict)
    metric_confidences: dict[str, float] = field(default_factory=dict)
    contexts: set[str] = field(default_factory=set)
    mean_confidence: float = 1.0
    motion_flagged_count: int = 0
    excluded: bool = False


def parse_utc(ts: str | datetime) -> datetime:
    if isinstance(ts, datetime):
        return ts.astimezone(timezone.utc) if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    normalized = ts.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def get_circadian_block(hour_utc: int, tz_offset_hours: float = 5.5) -> str:
    local_hour = int((hour_utc + tz_offset_hours) % 24)
    if local_hour >= 22 or local_hour < 6:
        return "night"
    if 6 <= local_hour < 12:
        return "morning"
    if 12 <= local_hour < 18:
        return "afternoon"
    return "evening"


def normalize_samples(raw_samples: list[dict[str, Any]]) -> list[SamplePoint]:
    out: list[SamplePoint] = []
    for row in raw_samples:
        metric = str(row.get("metricType") or row.get("metric_type") or "")
        if not metric:
            continue
        try:
            val = float(row["value"])
            ts = parse_utc(row.get("recordedAt") or row.get("recorded_at"))
        except (KeyError, TypeError, ValueError):
            continue
        if not np.isfinite(val):
            continue
        conf = float(row.get("dataConfidence") or row.get("data_confidence") or 1.0)
        conf = float(np.clip(conf, 0.05, 1.0))
        flags = [str(f) for f in (row.get("qualityFlags") or row.get("quality_flags") or [])]
        ctx = str(row.get("context") or "unknown")
        out.append(
            SamplePoint(
                metric_type=metric,
                value=val,
                unit=str(row.get("unit") or ""),
                recorded_at=ts,
                context=ctx,
                confidence=conf,
                quality_flags=flags,
                is_synthetic=bool(row.get("isSynthetic") or row.get("is_synthetic") or False),
            )
        )
    out.sort(key=lambda s: s.recorded_at)
    return out


def parse_exclusions(raw_exclusions: list[dict[str, Any]]) -> list[tuple[datetime, datetime, str]]:
    spans: list[tuple[datetime, datetime, str]] = []
    for item in raw_exclusions:
        try:
            start = parse_utc(item.get("startsAt") or item.get("starts_at"))
            end = parse_utc(item.get("endsAt") or item.get("ends_at"))
            reason = str(item.get("reason") or "excluded")
            if end >= start:
                spans.append((start, end, reason))
        except (TypeError, ValueError):
            continue
    return spans


def is_excluded_time(ts: datetime, spans: list[tuple[datetime, datetime, str]]) -> bool:
    return any(start <= ts <= end for start, end, _ in spans)


def aggregate_hourly_timeline(
    samples: list[SamplePoint],
    exclusions: list[tuple[datetime, datetime, str]] | None = None,
    tz_offset_hours: float = 5.5,
) -> list[HourlyBucket]:
    """Builds chronological hourly physiological feature vectors preserving context and quality."""
    spans = exclusions or []
    grouped: dict[datetime, list[SamplePoint]] = defaultdict(list)
    for s in samples:
        hour_ts = s.recorded_at.replace(minute=0, second=0, microsecond=0)
        grouped[hour_ts].append(s)

    buckets: list[HourlyBucket] = []
    for hour_ts in sorted(grouped.keys()):
        pts = grouped[hour_ts]
        per_metric_vals: dict[str, list[float]] = defaultdict(list)
        per_metric_w: dict[str, list[float]] = defaultdict(list)
        contexts: set[str] = set()
        motion_count = 0
        confs: list[float] = []

        for p in pts:
            contexts.add(p.context)
            confs.append(p.confidence)
            if "motion_artifact" in p.quality_flags:
                motion_count += 1
            per_metric_vals[p.metric_type].append(p.value)
            per_metric_w[p.metric_type].append(p.confidence)

        metrics: dict[str, float] = {}
        metric_confs: dict[str, float] = {}
        for m, vals in per_metric_vals.items():
            ws = np.asarray(per_metric_w[m], dtype=float)
            arr = np.asarray(vals, dtype=float)
            if m == "steps":
                metrics[m] = float(np.sum(arr))
            elif float(np.sum(ws)) > 0:
                # Weighted median when multiple points exist in the same hour
                order = np.argsort(arr)
                arr_s = arr[order]
                ws_s = ws[order]
                cum_w = np.cumsum(ws_s) / np.sum(ws_s)
                idx = int(np.searchsorted(cum_w, 0.5))
                idx = min(idx, len(arr_s) - 1)
                metrics[m] = float(arr_s[idx])
            else:
                metrics[m] = float(np.median(arr))
            metric_confs[m] = float(np.mean(ws))

        # Backfill resting_heart_rate from sleep/rest heart_rate only if RHR absent in that hour
        if "resting_heart_rate" not in metrics and "heart_rate" in metrics:
            calm_hrs = [
                p.value
                for p in pts
                if p.metric_type == "heart_rate" and p.context in ("sleep", "rest")
            ]
            if calm_hrs:
                metrics["resting_heart_rate"] = float(np.median(calm_hrs))
                metric_confs["resting_heart_rate"] = float(
                    np.mean(
                        [
                            p.confidence
                            for p in pts
                            if p.metric_type == "heart_rate" and p.context in ("sleep", "rest")
                        ]
                    )
                )

        local_dt = datetime.fromtimestamp(
            hour_ts.timestamp() + tz_offset_hours * 3600.0, tz=timezone.utc
        )
        buckets.append(
            HourlyBucket(
                hour_utc=hour_ts,
                circadian_block=get_circadian_block(hour_ts.hour, tz_offset_hours),
                is_weekend=local_dt.weekday() >= 5,
                metrics=metrics,
                metric_confidences=metric_confs,
                contexts=contexts,
                mean_confidence=float(np.mean(confs)) if confs else 1.0,
                motion_flagged_count=motion_count,
                excluded=is_excluded_time(hour_ts, spans),
            )
        )

    return buckets
