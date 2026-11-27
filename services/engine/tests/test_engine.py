"""Comprehensive tests for SENTINEL Phase 3 baseline & 3-layer detection engine."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from app.main import app
from engine.baseline import fit_personal_baselines
from engine.conditions import compute_partial_news2
from engine.datasets.loaders import (
    load_lifesnaps_records,
    load_mmash_records,
    load_pmdata_records,
    load_wesad_summary_records,
)
from engine.detectors import evaluate_patient_window
from engine.eval_harness import run_benchmark
from engine.features import aggregate_hourly_timeline, normalize_samples, parse_exclusions
from sim.generator import generate_scenario

client = TestClient(app)


def test_golden_clinical_scenarios_detection_and_exercise_suppression() -> None:
    stable = generate_scenario("baseline_stable", seed=42, total_days=18)
    stable_res = evaluate_patient_window("p-stable", stable.samples, ["general_frailty"], age=72)
    assert stable_res["baseline"]["stage"] == "calibrated"
    assert stable_res["deteriorationIndex"] < 30.0
    assert stable_res["level"] == "stable"

    exercise = generate_scenario("exercise_confounder", seed=42, total_days=18)
    ex_res = evaluate_patient_window("p-ex", exercise.samples, ["general_frailty"], age=72)
    assert ex_res["level"] == "stable", f"Exercise triggered false positive: {ex_res}"
    assert "active_exercise_suppressed" in ex_res["decisionLog"]["suppressedConfounders"] or (
        "exercise_hr_elevated_during_high_steps" in ex_res["decisionLog"]["suppressedConfounders"]
    )

    infection = generate_scenario("early_infection", seed=42, total_days=18)
    inf_res = evaluate_patient_window("p-inf", infection.samples, ["general_frailty"], age=72)
    assert inf_res["level"] in ("warning", "urgent")
    assert inf_res["deteriorationIndex"] >= 55.0
    assert len(inf_res["contributions"]) >= 3
    # Ensure safety framing rule ("never you have")
    assert "diagnos" not in inf_res["summaryText"].lower()
    assert "personal normal" in inf_res["summaryText"].lower()

    copd = generate_scenario("copd_exacerbation", seed=42, total_days=18)
    copd_res = evaluate_patient_window("p-copd", copd.samples, ["copd"], age=74)
    assert copd_res["level"] in ("warning", "urgent")
    assert copd_res["partialNews2"]["spo2Scale"] == 2

    hf = generate_scenario("hf_decompensation", seed=42, total_days=18)
    hf_res = evaluate_patient_window("p-hf", hf.samples, ["heart_failure"], age=75)
    assert hf_res["level"] in ("warning", "urgent")

    arr = generate_scenario("arrhythmia_episode", seed=42, total_days=18)
    arr_res = evaluate_patient_window("p-arr", arr.samples, ["arrhythmia"], age=73)
    assert arr_res["level"] in ("watch", "warning", "urgent")
    assert arr_res["deteriorationIndex"] >= 45.0


def test_contamination_quarantine_and_excluded_periods() -> None:
    stable = generate_scenario("baseline_stable", seed=99, total_days=18)
    now = datetime.now(timezone.utc)
    # Inject artificial illness window between days 12 and 14 marked as excluded period
    excl_start = now - timedelta(days=6)
    excl_end = now - timedelta(days=4)

    contaminated = list(stable.samples)
    for h in range(48):
        ts = (excl_start + timedelta(hours=h)).isoformat()
        contaminated.append(
            {
                "metricType": "resting_heart_rate",
                "value": 122.0,
                "unit": "bpm",
                "recordedAt": ts,
                "context": "rest",
                "isSynthetic": True,
            }
        )

    samples = normalize_samples(contaminated)
    spans = parse_exclusions([{"startsAt": excl_start.isoformat(), "endsAt": excl_end.isoformat(), "reason": "fever_illness"}])
    buckets_ex = aggregate_hourly_timeline(samples, spans)
    bl_with_excl = fit_personal_baselines("p-quar", buckets_ex, ["general_frailty"], age=70)
    rhr_med = bl_with_excl.metrics["resting_heart_rate"].median
    # Personal median must remain near true 64 bpm rather than drifting toward 122 bpm
    assert 60.0 <= rhr_med <= 69.0


def test_partial_news2_marks_missing_wearable_fields_explicitly() -> None:
    news2 = compute_partial_news2(
        {"resting_heart_rate": 115.0, "spo2": 93.0, "respiratory_rate": 22.0},
        spo2_scale=1,
    )
    assert news2["partialScore"] == 6  # pulse 2 + spo2 2 + rr 2
    assert news2["scoredParameterCount"] == 3
    params = {p["parameter"]: p for p in news2["parameters"]}
    assert params["consciousness_acvpu"]["status"] == "unavailable_from_wearable"
    assert params["air_or_oxygen"]["status"] == "unavailable_from_wearable"
    assert params["systolic_bp"]["status"] == "unavailable_from_wearable"


@given(
    rhr=st.floats(min_value=45.0, max_value=145.0, allow_nan=False, allow_infinity=False),
    spo2=st.floats(min_value=82.0, max_value=100.0, allow_nan=False, allow_infinity=False),
    rr=st.floats(min_value=10.0, max_value=30.0, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=20, deadline=None)
def test_property_deterioration_index_bounded_and_deterministic(
    rhr: float, spo2: float, rr: float
) -> None:
    now = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)
    samples = []
    for d in range(15):
        ts = (now - timedelta(days=15 - d)).isoformat()
        samples.extend(
            [
                {"metricType": "resting_heart_rate", "value": 64.0, "unit": "bpm", "recordedAt": ts, "context": "sleep"},
                {"metricType": "spo2", "value": 97.0, "unit": "%", "recordedAt": ts, "context": "sleep"},
                {"metricType": "respiratory_rate", "value": 15.0, "unit": "breaths/min", "recordedAt": ts, "context": "sleep"},
                {"metricType": "hrv_rmssd", "value": 34.0, "unit": "ms", "recordedAt": ts, "context": "sleep"},
                {"metricType": "steps", "value": 350.0, "unit": "count", "recordedAt": ts, "context": "light_activity"},
            ]
        )
    # Current test point
    t_now = now.isoformat()
    samples.extend(
        [
            {"metricType": "resting_heart_rate", "value": rhr, "unit": "bpm", "recordedAt": t_now, "context": "rest"},
            {"metricType": "spo2", "value": spo2, "unit": "%", "recordedAt": t_now, "context": "rest"},
            {"metricType": "respiratory_rate", "value": rr, "unit": "breaths/min", "recordedAt": t_now, "context": "rest"},
        ]
    )
    r1 = evaluate_patient_window("p-prop", samples, ["general_frailty"], reference_now=now, fast_mode=True)
    r2 = evaluate_patient_window("p-prop", samples, ["general_frailty"], reference_now=now, fast_mode=True)
    assert 0.0 <= r1["deteriorationIndex"] <= 100.0
    assert r1["deteriorationIndex"] == r2["deteriorationIndex"]
    assert r1["level"] in ("stable", "watch", "warning", "urgent")


def test_benchmark_ablation_and_dataset_adapters_and_api() -> None:
    bench = run_benchmark(seeds=[42], total_days=16, include_ablations=True)
    full = bench["ablations"]["L1_L2_L3_full"]
    fixed = bench["ablations"]["fixed_clinical_only"]
    assert full["sensitivity"] >= fixed["sensitivity"]
    assert full["sensitivity"] >= 0.85
    assert full["falseAlertsPerPatientWeek"] == 0.0

    # Verify all 4 dataset schema loaders
    pm = load_pmdata_records("date,resting_heart_rate,steps\n2026-11-20,64,4200\n")
    ls = load_lifesnaps_records('[{"dateTime":"2026-11-20T06:00:00Z","bpm":63,"rmssd":35,"spo2":97}]')
    ws = load_wesad_summary_records("timestamp,hr_bpm,rmssd_ms,temp_dev_c\n2026-11-20T07:00:00Z,71,29,0.3\n")
    mm = load_mmash_records("timestamp,ibi_ms,steps\n2026-11-20T08:00:00Z,880,140\n")
    assert len(pm) == 2 and len(ls) == 3 and len(ws) == 3 and len(mm) == 2

    # FastAPI endpoint check
    resp = client.post(
        "/v1/score/evaluate",
        json={
            "patientId": "api-test",
            "samples": generate_scenario("early_infection", seed=42, total_days=16).samples,
            "conditions": ["general_frailty"],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["level"] in ("watch", "warning", "urgent")
    assert body["decisionLog"]["l3Details"]["autoencoderStatus"] == "disabled_by_default"
