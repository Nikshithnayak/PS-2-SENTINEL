"""Seeded physiologically plausible wearable telemetry generator.

Assumptions & Limitations:
- Models hourly nocturnal/diurnal circadian variation for elderly adults (65-80 yrs).
- Nocturnal window (22:00-06:00 local) produces sleep-context RHR, HRV (RMSSD),
  respiratory rate, skin-temperature deviation, and sleep summary metrics.
- Daytime window (06:00-22:00 local) produces rest/light_activity/exercise context
  samples with realistic step bursts and occasional motion-artifact noise.
- Every emitted sample is strictly tagged `isSynthetic=True`, `source="synthetic_sim"`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import numpy as np

ScenarioName = Literal[
    "baseline_stable",
    "early_infection",
    "hf_decompensation",
    "copd_exacerbation",
    "arrhythmia_episode",
    "dehydration_heat",
    "post_discharge_decline",
    "missed_medication",
    "fall_event",
    "exercise_confounder",
    "off_wrist_silence",
]

SCENARIO_CATALOG: dict[ScenarioName, str] = {
    "baseline_stable": "Healthy calibrated 21-day elder baseline with normal circadian rhythm",
    "early_infection": "Systemic febrile/infection prodrome: skin temp +0.9°C, RHR +13 bpm, HRV -35%, RR +4",
    "hf_decompensation": "5-day fluid overload drift: RHR +11 bpm, nocturnal RR +5, steps -45%, sleep eff -18%, weight +2.4kg",
    "copd_exacerbation": "COPD flare on hypercapnic baseline (~91% SpO2 dropping to 85%, RR 18->26/min, steps -40%)",
    "arrhythmia_episode": "Paroxysmal resting tachycardia / AFib burden burst (HR 138-152 bpm at rest, AFib burden 28%)",
    "dehydration_heat": "Coastal heat-wave strain: RHR +12 bpm disproportionate to low steps, skin temp +0.5°C, HRV -25%",
    "post_discharge_decline": "7-day post-discharge functional decline: steps -50%, sleep fragmented, non-recovering RHR/HRV",
    "missed_medication": "Missed beta-blocker rebound: RHR +16 bpm & systolic BP +18 mmHg after hour 36",
    "fall_event": "Abrupt mid-day mobility halt, brief HR spike (128 bpm), followed by 4h inactivity",
    "exercise_confounder": "Benign brisk morning walk (HR 132 bpm paired with 115 steps/min) — must NOT trigger alarm",
    "off_wrist_silence": "Normal baseline followed by 18 hours of zero telemetry (device_silent safety test)",
}


@dataclass
class GeneratedScenario:
    scenario: ScenarioName
    seed: int
    total_days: int
    onset_at: str | None
    description: str
    samples: list[dict[str, Any]]
    expected_alert_level: str


def generate_scenario(
    scenario: ScenarioName,
    seed: int = 42,
    total_days: int = 18,
    end_time: datetime | None = None,
    base_rhr: float = 64.0,
    base_hrv: float = 34.0,
    base_spo2: float = 97.0,
    base_rr: float = 15.0,
) -> GeneratedScenario:
    rng = np.random.default_rng(seed)
    now = (end_time or datetime.now(timezone.utc)).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=total_days)

    # For COPD, personal baseline SpO2 is hypercapnic (89-92% scale 2)
    if scenario == "copd_exacerbation" and base_spo2 > 93.0:
        base_spo2 = 91.0
        base_rr = 18.0

    onset_hours_before_end = {
        "baseline_stable": None,
        "early_infection": 42,
        "hf_decompensation": 96,
        "copd_exacerbation": 48,
        "arrhythmia_episode": 16,
        "dehydration_heat": 30,
        "post_discharge_decline": 120,
        "missed_medication": 36,
        "fall_event": 8,
        "exercise_confounder": 6,
        "off_wrist_silence": 18,
    }[scenario]

    onset_dt = (
        now - timedelta(hours=onset_hours_before_end)
        if onset_hours_before_end is not None
        else None
    )

    samples: list[dict[str, Any]] = []
    total_hours = total_days * 24

    def add(
        ts: datetime,
        metric_type: str,
        value: float,
        unit: str,
        context: str,
        window_seconds: int = 3600,
    ) -> None:
        samples.append(
            {
                "metricType": metric_type,
                "value": round(float(value), 2),
                "unit": unit,
                "recordedAt": ts.isoformat(),
                "windowSeconds": window_seconds,
                "context": context,
                "source": "synthetic_sim",
                "deviceModel": "SENTINEL-Sim-Watch-v1",
                "isSynthetic": True,
            }
        )

    for h in range(total_hours):
        ts = start + timedelta(hours=h)
        # Convert UTC to approximate IST (+05:30) hour of day for realistic elder circadian phase
        ist_hour = (ts.hour + 5 + (1 if ts.minute >= 30 else 0)) % 24
        is_sleep = ist_hour >= 22 or ist_hour < 6
        ctx = "sleep" if is_sleep else "rest"

        if scenario == "off_wrist_silence" and onset_dt is not None and ts >= onset_dt:
            continue

        # Circadian baseline modulation
        circadian_hr = -3.5 if is_sleep else (2.5 if 10 <= ist_hour <= 19 else 0.0)
        circadian_temp = -0.15 if is_sleep else 0.10

        rhr_val = base_rhr + circadian_hr + rng.normal(0, 1.8)
        hrv_val = base_hrv + (5.0 if is_sleep else -2.0) + rng.normal(0, 3.2)
        spo2_val = base_spo2 + rng.normal(0, 0.6)
        rr_val = base_rr + (-0.8 if is_sleep else 0.5) + rng.normal(0, 0.9)
        temp_dev = circadian_temp + rng.normal(0, 0.12)
        steps_val = 0.0 if is_sleep else max(0.0, rng.normal(320 if 7 <= ist_hour <= 19 else 90, 95))

        # Apply deterioration trajectories after onset
        if onset_dt is not None and ts >= onset_dt:
            hrs_since = (ts - onset_dt).total_seconds() / 3600.0
            ramp = min(1.0, hrs_since / 24.0)

            if scenario == "early_infection":
                rhr_val += 4.0 + 10.0 * ramp
                hrv_val *= max(0.45, 1.0 - 0.36 * ramp)
                temp_dev += 0.35 + 0.65 * ramp
                rr_val += 1.5 + 3.0 * ramp
                steps_val *= max(0.25, 1.0 - 0.6 * ramp)

            elif scenario == "hf_decompensation":
                slow_ramp = min(1.0, hrs_since / 72.0)
                rhr_val += 3.0 + 9.0 * slow_ramp
                hrv_val *= max(0.55, 1.0 - 0.28 * slow_ramp)
                rr_val += 1.5 + 4.5 * slow_ramp
                spo2_val -= 2.2 * slow_ramp
                steps_val *= max(0.35, 1.0 - 0.52 * slow_ramp)

            elif scenario == "copd_exacerbation":
                rhr_val += 5.0 * ramp
                rr_val += 3.0 + 5.5 * ramp
                spo2_val -= 2.5 + 3.5 * ramp
                steps_val *= max(0.3, 1.0 - 0.5 * ramp)

            elif scenario == "arrhythmia_episode":
                if int(hrs_since) % 4 in (0, 1, 2):
                    rhr_val += rng.uniform(55.0, 82.0)
                    # Erratic beat-to-beat IBI inflates RMSSD artificially during AFib
                    hrv_val += rng.uniform(45.0, 75.0)
                    add(ts, "afib_burden", 28.0 + rng.uniform(0, 14), "%", "rest")

            elif scenario == "dehydration_heat":
                rhr_val += 11.5 * ramp
                temp_dev += 0.45 * ramp
                hrv_val *= max(0.6, 1.0 - 0.25 * ramp)
                steps_val *= 0.65

            elif scenario == "post_discharge_decline":
                slow_ramp = min(1.0, hrs_since / 96.0)
                rhr_val += 7.5 * slow_ramp
                hrv_val *= max(0.6, 1.0 - 0.30 * slow_ramp)
                steps_val *= max(0.25, 1.0 - 0.62 * slow_ramp)

            elif scenario == "missed_medication":
                rhr_val += 15.0 * ramp
                add(ts, "systolic_bp", 156.0 + rng.normal(0, 4.0), "mmHg", "rest")

            elif scenario == "fall_event":
                if hrs_since < 1.0:
                    add(ts, "heart_rate", 128.0, "bpm", "unknown", 60)
                    steps_val = 0.0
                else:
                    steps_val = 0.0
                    continue

            elif scenario == "exercise_confounder":
                # Benign morning walk between onset and onset+2h: high HR paired with high steps
                if hrs_since <= 2.0:
                    add(ts, "heart_rate", 132.0 + rng.normal(0, 3.0), "bpm", "exercise", 900)
                    add(ts, "steps", 115.0, "count", "exercise", 300)
                    continue

        hrv_val = max(5.0, hrv_val)
        spo2_val = float(np.clip(spo2_val, 72.0, 100.0))
        rr_val = max(6.0, rr_val)

        if is_sleep or ist_hour in (8, 12, 16, 20):
            add(ts, "resting_heart_rate", rhr_val, "bpm", ctx)
            add(ts, "heart_rate", rhr_val + (0 if is_sleep else 6), "bpm", ctx)
            add(ts, "hrv_rmssd", hrv_val, "ms", ctx)
            add(ts, "respiratory_rate", rr_val, "breaths/min", ctx)
            add(ts, "spo2", spo2_val, "%", ctx)
            add(ts, "skin_temp_deviation", temp_dev, "degC", ctx)
        else:
            add(ts, "heart_rate", rhr_val + 8.0 + min(22.0, steps_val / 25.0), "bpm", "light_activity")

        if not is_sleep:
            add(ts, "steps", steps_val, "count", "light_activity")

        # Emit morning sleep summary at 06:00 IST
        if ist_hour == 6:
            in_deterioration = onset_dt is not None and ts >= onset_dt
            sleep_dur = 415.0 + rng.normal(0, 18.0)
            sleep_eff = 87.0 + rng.normal(0, 2.5)
            awakenings = 1.0 + max(0.0, rng.normal(0.5, 0.7))
            if in_deterioration and scenario in ("hf_decompensation", "post_discharge_decline", "early_infection"):
                sleep_dur -= 75.0
                sleep_eff -= 18.0
                awakenings += 4.0
                if scenario == "hf_decompensation":
                    add(ts, "weight_kg", 68.4, "kg", "rest")
            else:
                if scenario == "hf_decompensation":
                    add(ts, "weight_kg", 66.0 + rng.normal(0, 0.2), "kg", "rest")

            add(ts, "sleep_duration_min", max(120.0, sleep_dur), "min", "sleep", 28800)
            add(ts, "sleep_efficiency", float(np.clip(sleep_eff, 40.0, 98.0)), "%", "sleep", 28800)
            add(ts, "sleep_awakenings", round(awakenings), "count", "sleep", 28800)

    expected_level = {
        "baseline_stable": "stable",
        "exercise_confounder": "stable",
        "off_wrist_silence": "watch",
        "dehydration_heat": "watch",
        "post_discharge_decline": "warning",
        "missed_medication": "warning",
        "early_infection": "warning",
        "hf_decompensation": "warning",
        "copd_exacerbation": "urgent",
        "arrhythmia_episode": "urgent",
        "fall_event": "urgent",
    }[scenario]

    return GeneratedScenario(
        scenario=scenario,
        seed=seed,
        total_days=total_days,
        onset_at=onset_dt.isoformat() if onset_dt else None,
        description=SCENARIO_CATALOG[scenario],
        samples=samples,
        expected_alert_level=expected_level,
    )
