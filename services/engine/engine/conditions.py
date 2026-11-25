"""Clinical condition profiles, priors, and transparent partial NEWS2 calculator."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ConditionConfig:
    id: str
    label: str
    metric_weights: dict[str, float]
    spo2_scale: int  # 1 = standard, 2 = hypercapnic COPD
    watch_notes: str


CONDITION_MODULES: dict[str, ConditionConfig] = {
    "general_frailty": ConditionConfig(
        id="general_frailty",
        label="General Senior Frailty",
        metric_weights={
            "resting_heart_rate": 1.15,
            "hrv_rmssd": 1.15,
            "spo2": 1.25,
            "respiratory_rate": 1.2,
            "skin_temp_deviation": 1.05,
            "steps": 1.1,
            "sleep_efficiency": 0.95,
            "sleep_duration_min": 0.9,
            "sleep_awakenings": 0.95,
            "afib_burden": 1.15,
        },
        spo2_scale=1,
        watch_notes="Monitors functional mobility drop, nocturnal rest disruption, and multi-signal autonomic strain.",
    ),
    "heart_failure": ConditionConfig(
        id="heart_failure",
        label="Heart Failure Management",
        metric_weights={
            "resting_heart_rate": 1.35,
            "hrv_rmssd": 1.25,
            "spo2": 1.3,
            "respiratory_rate": 1.4,
            "weight_kg": 1.5,
            "steps": 1.2,
            "sleep_efficiency": 1.15,
            "sleep_awakenings": 1.15,
            "skin_temp_deviation": 0.85,
        },
        spo2_scale=1,
        watch_notes="Prioritizes fluid overload indicators (rapid weight rise, orthopnea/nocturnal tachypnea, falling step tolerance, elevated RHR).",
    ),
    "copd": ConditionConfig(
        id="copd",
        label="COPD / Chronic Pulmonary (NEWS2 Scale 2)",
        metric_weights={
            "spo2": 1.55,
            "respiratory_rate": 1.5,
            "resting_heart_rate": 1.15,
            "hrv_rmssd": 1.05,
            "steps": 1.1,
            "sleep_efficiency": 0.9,
            "skin_temp_deviation": 1.1,
        },
        spo2_scale=2,
        watch_notes="Applies NEWS2 Scale 2 hypercapnic SpO2 bounds (target 88-92%) and elevates respiratory rate + hypoxemia drops.",
    ),
    "hypertension": ConditionConfig(
        id="hypertension",
        label="Hypertension & Cardiovascular",
        metric_weights={
            "systolic_bp": 1.45,
            "resting_heart_rate": 1.25,
            "hrv_rmssd": 1.15,
            "afib_burden": 1.35,
            "steps": 0.9,
        },
        spo2_scale=1,
        watch_notes="Tracks rebound blood pressure spikes, resting tachycardia, and autonomic recovery.",
    ),
    "diabetes": ConditionConfig(
        id="diabetes",
        label="Type 2 Diabetes / Autonomic Care",
        metric_weights={
            "resting_heart_rate": 1.2,
            "hrv_rmssd": 1.3,
            "blood_glucose": 1.35,
            "skin_temp_deviation": 1.1,
            "steps": 1.05,
            "spo2": 1.1,
            "respiratory_rate": 1.1,
            "sleep_efficiency": 0.95,
        },
        spo2_scale=1,
        watch_notes="Prioritizes autonomic tone (HRV suppression + nocturnal RHR elevation) alongside fever/dehydration signs.",
    ),
    "arrhythmia": ConditionConfig(
        id="arrhythmia",
        label="Arrhythmia / AFib Surveillance",
        metric_weights={
            "afib_burden": 1.6,
            "resting_heart_rate": 1.45,
            "heart_rate": 1.35,
            "hrv_rmssd": 1.1,
            "spo2": 1.15,
            "steps": 0.85,
        },
        spo2_scale=1,
        watch_notes="Weights paroxysmal resting tachycardia and AFib burden above isolated step noise.",
    ),
}

# Age-aware population priors (for shrinkage during Day 1-14 calibration only).
DEFAULT_POPULATION_PRIORS: dict[str, tuple[float, float]] = {
    "resting_heart_rate": (66.0, 7.5),
    "heart_rate": (76.0, 12.0),
    "hrv_rmssd": (32.0, 11.0),
    "spo2": (96.8, 1.4),
    "respiratory_rate": (15.5, 2.0),
    "skin_temp_deviation": (0.0, 0.35),
    "body_temperature": (36.7, 0.35),
    "steps": (320.0, 160.0),
    "sleep_efficiency": (85.0, 6.0),
    "sleep_duration_min": (420.0, 45.0),
    "sleep_awakenings": (1.5, 1.0),
    "systolic_bp": (126.0, 13.0),
    "blood_glucose": (110.0, 22.0),
    "weight_kg": (66.0, 5.0),
    "afib_burden": (0.2, 1.0),
}


def get_priors_for_conditions(
    conditions: list[str], age: int | None = None
) -> tuple[dict[str, tuple[float, float]], dict[str, float], int]:
    """Computes blended priors, metric weights, and active SpO2 NEWS2 scale (1 or 2)."""
    priors = dict(DEFAULT_POPULATION_PRIORS)
    if age is not None and age >= 70:
        priors["hrv_rmssd"] = (27.0, 10.0)
        priors["steps"] = (145.0, 120.0)

    weights: dict[str, float] = {}
    spo2_scale = 1
    active = [c for c in conditions if c in CONDITION_MODULES] or ["general_frailty"]
    for cid in active:
        cfg = CONDITION_MODULES[cid]
        if cfg.spo2_scale == 2:
            spo2_scale = 2
        for m, w in cfg.metric_weights.items():
            weights[m] = max(weights.get(m, 1.0), w)

    if spo2_scale == 2:
        priors["spo2"] = (90.5, 2.0)
        priors["respiratory_rate"] = (18.0, 2.2)

    return priors, weights, spo2_scale


def compute_partial_news2(
    latest_metrics: dict[str, float],
    spo2_scale: int = 1,
    is_exercise_context: bool = False,
) -> dict[str, Any]:
    """Computes strictly observable subset of Royal College of Physicians NEWS2 parameters.

    Important safety invariant: wearable streams do NOT reliably capture ACVPU consciousness,
    supplemental O2 therapy flag, or continuous cuff BP. Missing components are explicitly
    marked as `unavailable_from_wearable` rather than silently assumed normal.
    """
    breakdown: list[dict[str, Any]] = []
    partial_total = 0

    def add_param(
        name: str,
        value: float | None,
        score: int | None,
        status: str,
        rule: str,
    ) -> None:
        nonlocal partial_total
        if score is not None:
            partial_total += score
        breakdown.append(
            {
                "parameter": name,
                "observedValue": round(value, 2) if value is not None else None,
                "points": score,
                "status": status,
                "rule": rule,
            }
        )

    # 1. Respiratory Rate (/min)
    rr = latest_metrics.get("respiratory_rate")
    if rr is None:
        add_param("respiratory_rate", None, None, "missing_recent", "No recent respiratory rate")
    else:
        if rr <= 8 or rr >= 25:
            pts = 3
        elif 21 <= rr <= 24:
            pts = 2
        elif 9 <= rr <= 11:
            pts = 1
        else:
            pts = 0
        add_param("respiratory_rate", rr, pts, "scored", "NEWS2 RR bands (normal 12-20)")

    # 2. SpO2 (Scale 1 or COPD Scale 2 assuming room air unless noted)
    spo2 = latest_metrics.get("spo2")
    if spo2 is None:
        add_param("spo2", None, None, "missing_recent", f"Scale {spo2_scale}; no recent SpO2")
    else:
        if spo2_scale == 2:
            if spo2 <= 83:
                pts = 3
            elif 84 <= spo2 <= 85:
                pts = 2
            elif 86 <= spo2 <= 87:
                pts = 1
            else:
                pts = 0  # >=88 on room air without documented O2 supplementation
            add_param(
                "spo2",
                spo2,
                pts,
                "scored",
                "NEWS2 Scale 2 (hypercapnic target 88-92% room air; supplemental O2 status unverified)",
            )
        else:
            if spo2 <= 91:
                pts = 3
            elif 92 <= spo2 <= 93:
                pts = 2
            elif 94 <= spo2 <= 95:
                pts = 1
            else:
                pts = 0
            add_param("spo2", spo2, pts, "scored", "NEWS2 Scale 1 (>=96 normal)")

    # 3. Pulse / Resting Heart Rate (suppressed only during explicit active exercise)
    hr = latest_metrics.get("resting_heart_rate") or latest_metrics.get("heart_rate")
    if hr is None:
        add_param("pulse", None, None, "missing_recent", "No recent calm heart rate")
    elif is_exercise_context and "resting_heart_rate" not in latest_metrics:
        add_param("pulse", hr, 0, "exercise_contextualized", "Active exercise HR excluded from resting NEWS2")
    else:
        if hr <= 40 or hr >= 131:
            pts = 3
        elif 111 <= hr <= 130:
            pts = 2
        elif hr <= 50 or (91 <= hr <= 110):
            pts = 1
        else:
            pts = 0
        add_param("pulse", hr, pts, "scored", "NEWS2 resting pulse bands (51-90 normal)")

    # 4. Temperature (Body temp preferred; skin temp noted as peripheral proxy)
    temp = latest_metrics.get("body_temperature")
    if temp is not None:
        if temp <= 35.0:
            pts = 3
        elif temp >= 39.1:
            pts = 2
        elif temp <= 36.0 or temp >= 38.1:
            pts = 1
        else:
            pts = 0
        add_param("temperature", temp, pts, "scored", "NEWS2 core temperature bands (36.1-38.0 normal)")
    else:
        add_param(
            "temperature",
            latest_metrics.get("skin_temp_deviation"),
            None,
            "proxy_skin_temp_only",
            "Only wrist skin temperature deviation available; peripheral skin temp cannot directly score core NEWS2",
        )

    # 5. Systolic BP (cuff/manual optional)
    sbp = latest_metrics.get("systolic_bp")
    if sbp is not None:
        if sbp <= 90 or sbp >= 220:
            pts = 3
        elif 91 <= sbp <= 100:
            pts = 2
        elif 101 <= sbp <= 110:
            pts = 1
        else:
            pts = 0
        add_param("systolic_bp", sbp, pts, "scored", "NEWS2 systolic BP bands (111-219 normal)")
    else:
        add_param(
            "systolic_bp",
            None,
            None,
            "unavailable_from_wearable",
            "Requires cuff measurement",
        )

    # 6. Air or Oxygen & 7. Consciousness (ACVPU) — not wearable-observable
    add_param(
        "air_or_oxygen",
        None,
        None,
        "unavailable_from_wearable",
        "Supplemental oxygen (+2 in NEWS2) cannot be auto-detected by wearable",
    )
    add_param(
        "consciousness_acvpu",
        None,
        None,
        "unavailable_from_wearable",
        "ACVPU neurological check requires caregiver/patient interaction",
    )

    scored_count = sum(1 for row in breakdown if row["status"] == "scored")
    return {
        "partialScore": partial_total,
        "maxObservablePoints": scored_count * 3,
        "scoredParameterCount": scored_count,
        "totalNews2Parameters": 7,
        "spo2Scale": spo2_scale,
        "disclaimer": "Partial wearable-derived NEWS2 subset only; missing BP, supplemental O2, and ACVPU cannot be scored passively.",
        "parameters": breakdown,
    }
