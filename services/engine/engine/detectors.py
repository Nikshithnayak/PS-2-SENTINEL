"""Deterministic 3-layer anomaly detection engine (L1 safety + L2 personal/CUSUM/ruptures + L3 Mahalanobis/River)."""

from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any

import numpy as np
import ruptures as rpt
from river.anomaly import HalfSpaceTrees
from scipy.stats import chi2
from sklearn.covariance import LedoitWolf, MinCovDet
from sklearn.ensemble import IsolationForest

from engine.baseline import BaselineModel, fit_personal_baselines
from engine.conditions import compute_partial_news2
from engine.features import (
    RISK_DIRECTION,
    HourlyBucket,
    aggregate_hourly_timeline,
    normalize_samples,
    parse_exclusions,
)

MODEL_VERSION = "sentinel-det-v1.0.0"

MULTIVARIATE_METRICS = (
    "resting_heart_rate",
    "hrv_rmssd",
    "spo2",
    "respiratory_rate",
    "skin_temp_deviation",
    "steps",
)

FRIENDLY_METRIC_NAMES: dict[str, tuple[str, str]] = {
    "resting_heart_rate": ("Resting Heart Rate", "bpm"),
    "heart_rate": ("Heart Rate", "bpm"),
    "hrv_rmssd": ("Heart Rate Variability", "ms"),
    "spo2": ("Blood Oxygen (SpO2)", "%"),
    "respiratory_rate": ("Breathing Rate", "breaths/min"),
    "skin_temp_deviation": ("Skin Temperature Shift", "°C"),
    "body_temperature": ("Body Temperature", "°C"),
    "steps": ("Hourly Activity", "steps"),
    "sleep_efficiency": ("Sleep Efficiency", "%"),
    "sleep_duration_min": ("Sleep Duration", "min"),
    "sleep_awakenings": ("Night Awakenings", "count"),
    "systolic_bp": ("Systolic BP", "mmHg"),
    "blood_glucose": ("Blood Glucose", "mg/dL"),
    "weight_kg": ("Body Weight", "kg"),
    "afib_burden": ("Irregular Rhythm Share", "%"),
}


def _signed_z(
    metric: str,
    observed: float,
    expected: float,
    sigma: float,
) -> tuple[float, float, str]:
    """Returns (raw_z, risk_aligned_z >= 0, direction_label)."""
    raw_z = (observed - expected) / max(sigma, 1e-3)
    polarity = RISK_DIRECTION.get(metric, 0)
    if metric == "hrv_rmssd":
        # Falling HRV is stress; huge sudden jump (+3.0 sigma) is also relevant for AFib beat scatter
        if raw_z <= 0:
            return raw_z, -raw_z, "lower"
        return raw_z, max(0.0, raw_z - 2.2), "erratic_high" if raw_z > 2.8 else "normal"
    if polarity == 1:
        return raw_z, max(0.0, raw_z), "higher" if raw_z > 0.8 else ("lower" if raw_z < -1.0 else "normal")
    if polarity == -1:
        return raw_z, max(0.0, -raw_z), "lower" if raw_z < -0.8 else ("higher" if raw_z > 1.0 else "normal")
    return raw_z, abs(raw_z), "higher" if raw_z > 0.8 else ("lower" if raw_z < -0.8 else "normal")


def _detect_l1_safety(
    recent_buckets: list[HourlyBucket],
    baseline: BaselineModel,
) -> tuple[float, list[dict[str, Any]], list[str]]:
    """Evaluates L1 fixed clinical safety bounds on calm recent readings (exercise-guarded)."""
    score = 0.0
    triggers: list[dict[str, Any]] = []
    suppressed: list[str] = []

    if not recent_buckets:
        return 0.0, triggers, suppressed

    calm_buckets = [
        b
        for b in recent_buckets
        if not ("exercise" in b.contexts and b.metrics.get("steps", 0.0) >= 40.0)
    ]
    if len(calm_buckets) < len(recent_buckets):
        suppressed.append("exercise_hr_elevated_during_high_steps")

    eval_pool = calm_buckets[-6:] if calm_buckets else []
    if not eval_pool:
        return 0.0, triggers, suppressed

    spo2_crit = 84.0 if baseline.spo2_scale == 2 else 88.0
    spo2_warn = 86.0 if baseline.spo2_scale == 2 else 91.0

    # Weight change over trailing buckets if recorded
    weight_vals = [b.metrics["weight_kg"] for b in recent_buckets if "weight_kg" in b.metrics]
    if len(weight_vals) >= 2 and (weight_vals[-1] - weight_vals[0]) >= 1.8:
        delta = weight_vals[-1] - weight_vals[0]
        score = max(score, 52.0)
        triggers.append(
            {
                "rule": "rapid_weight_gain_hf",
                "detail": f"Weight up +{delta:.1f} kg across recent window",
                "severity": "warning",
            }
        )

    for b in eval_pool:
        rhr = b.metrics.get("resting_heart_rate")
        hr = b.metrics.get("heart_rate")
        steps = b.metrics.get("steps", 0.0)
        spo2 = b.metrics.get("spo2")
        rr = b.metrics.get("respiratory_rate")
        temp = b.metrics.get("body_temperature")
        sbp = b.metrics.get("systolic_bp")
        afib = b.metrics.get("afib_burden")
        conf = b.mean_confidence

        if spo2 is not None and conf >= 0.45:
            if spo2 < spo2_crit:
                score = max(score, 92.0)
                triggers.append({"rule": "critical_hypoxemia", "value": round(spo2, 1), "severity": "urgent"})
            elif spo2 <= spo2_warn:
                score = max(score, 62.0)
                triggers.append({"rule": "low_spo2_threshold", "value": round(spo2, 1), "severity": "warning"})

        if rr is not None:
            if rr >= 25.0 or rr <= 8.0:
                score = max(score, 78.0)
                triggers.append({"rule": "news2_respiratory_extreme", "value": round(rr, 1), "severity": "urgent"})
            elif rr >= 21.0:
                score = max(score, 44.0)
                triggers.append({"rule": "elevated_respiratory_rate", "value": round(rr, 1), "severity": "watch"})

        calm_pulse = rhr if rhr is not None else (hr if steps < 20.0 else None)
        if calm_pulse is not None:
            if calm_pulse >= 131.0 or calm_pulse <= 40.0:
                score = max(score, 85.0)
                triggers.append({"rule": "news2_resting_pulse_extreme", "value": round(calm_pulse, 1), "severity": "urgent"})
            elif calm_pulse >= 115.0:
                score = max(score, 58.0)
                triggers.append({"rule": "resting_tachycardia", "value": round(calm_pulse, 1), "severity": "warning"})

        if temp is not None and (temp >= 38.8 or temp <= 35.0):
            score = max(score, 75.0)
            triggers.append({"rule": "core_temperature_extreme", "value": round(temp, 1), "severity": "urgent"})

        if sbp is not None:
            if sbp >= 180.0 or sbp <= 85.0:
                score = max(score, 80.0)
                triggers.append({"rule": "bp_safety_bound", "value": round(sbp, 0), "severity": "urgent"})
            elif sbp >= 152.0:
                score = max(score, 42.0)
                triggers.append({"rule": "elevated_systolic_bp", "value": round(sbp, 0), "severity": "watch"})

        if afib is not None and afib >= 20.0:
            score = max(score, 72.0)
            triggers.append({"rule": "sustained_afib_burden", "value": round(afib, 1), "severity": "warning"})

    return score, triggers, suppressed


def _compute_hourly_risk_matrix(
    buckets: list[HourlyBucket],
    baseline: BaselineModel,
) -> tuple[np.ndarray, list[str], list[float], dict[str, dict[str, float]]]:
    """Computes aligned T x d directional risk z-scores and per-metric EWMA/CUSUM histories."""
    used_metrics = [m for m in MULTIVARIATE_METRICS if m in baseline.metrics]
    if not buckets or not used_metrics:
        return np.zeros((0, 0)), used_metrics, [], {}

    mat = np.zeros((len(buckets), len(used_metrics)), dtype=float)
    ewma_state: dict[str, float] = {m: 0.0 for m in used_metrics}
    cusum_state: dict[str, float] = {m: 0.0 for m in used_metrics}
    per_metric_stats: dict[str, dict[str, float]] = {
        m: {"lastZ": 0.0, "ewmaZ": 0.0, "cusum": 0.0, "maxRecentZ": 0.0}
        for m in used_metrics
    }
    composite_trace: list[float] = []

    for t, b in enumerate(buckets):
        is_exercise = "exercise" in b.contexts and b.metrics.get("steps", 0.0) >= 40.0
        row_vals: list[float] = []
        for j, m in enumerate(used_metrics):
            mb = baseline.metrics[m]
            raw_v = b.metrics.get(m)
            if raw_v is None:
                # Smoothly decay EWMA towards 0 during missing metric slots
                ewma_state[m] *= 0.85
                mat[t, j] = 0.0
                continue

            if is_exercise and m in ("resting_heart_rate", "heart_rate", "respiratory_rate", "steps"):
                # Exercise burst is NOT resting deterioration
                rz = 0.0
            else:
                expected = mb.expected_for(b.circadian_block, b.is_weekend)
                _, rz, _ = _signed_z(m, raw_v, expected, mb.sigma)
                rz *= min(1.0, b.metric_confidences.get(m, b.mean_confidence) + 0.15)
                rz = float(np.clip(rz, 0.0, 6.0))

            mat[t, j] = rz
            weight = baseline.metric_weights.get(m, 1.0)
            row_vals.append(rz * weight)

            ewma_state[m] = 0.25 * rz + 0.75 * ewma_state[m]
            # One-sided Page-Hinkley / CUSUM for persistent upward risk shift
            cusum_state[m] = max(0.0, min(14.0, cusum_state[m] + (rz - 0.85)))

            per_metric_stats[m]["lastZ"] = rz
            per_metric_stats[m]["ewmaZ"] = ewma_state[m]
            per_metric_stats[m]["cusum"] = cusum_state[m]
            if t >= max(0, len(buckets) - 12):
                per_metric_stats[m]["maxRecentZ"] = max(per_metric_stats[m]["maxRecentZ"], rz)

        composite_trace.append(float(np.mean(row_vals)) if row_vals else 0.0)

    return mat, used_metrics, composite_trace, per_metric_stats


def _detect_changepoints(buckets: list[HourlyBucket], trace: list[float]) -> list[str]:
    """Runs ruptures.Pelt change-point detection over multi-day composite strain."""
    if len(trace) < 24:
        return []
    arr = np.asarray(trace[-min(len(trace), 240) :], dtype=float)
    bucket_slice = buckets[-len(arr) :]
    if float(np.std(arr)) < 0.08:
        return []
    try:
        algo = rpt.Pelt(model="rbf", min_size=4, jump=2).fit(arr)
        idxs = algo.predict(pen=max(2.5, 0.45 * math.log(len(arr))))
    except Exception:
        return []
    cps: list[str] = []
    for idx in idxs[:-1]:
        if 0 <= idx < len(bucket_slice):
            cps.append(bucket_slice[idx].hour_utc.isoformat())
    return cps[-4:]


def _evaluate_l3_multivariate(
    mat: np.ndarray,
    baseline_split_idx: int,
) -> dict[str, Any]:
    """Computes robust Mahalanobis (MinCovDet) + River HalfSpaceTrees + IsolationForest."""
    enable_ae = os.getenv("ENABLE_AUTOENCODER_L3", "false").lower() == "true"
    result: dict[str, Any] = {
        "l3Score": 0.0,
        "mahalanobisDistance": 0.0,
        "chi2PValue": 1.0,
        "halfSpaceTreesScore": 0.0,
        "isolationForestScore": 0.0,
        "autoencoderScore": None,
        "autoencoderStatus": "enabled" if enable_ae else "disabled_by_default",
    }

    if mat.shape[0] < 24 or mat.shape[1] < 2:
        return result

    train_x = mat[: max(18, baseline_split_idx)]
    eval_x = mat[max(0, mat.shape[0] - 8) :]
    d = mat.shape[1]

    # Add micro jitter only to avoid degenerate exact-zero columns during covariance estimation
    rng = np.random.default_rng(42)
    train_jitter = train_x + rng.normal(0.0, 0.02, size=train_x.shape)

    # 1. MinCovDet robust Mahalanobis distance (fallback LedoitWolf if rank-deficient)
    try:
        if train_jitter.shape[0] >= max(24, 3 * d):
            cov_model = MinCovDet(random_state=42, support_fraction=0.8).fit(train_jitter)
        else:
            cov_model = LedoitWolf().fit(train_jitter)
        dists_sq = cov_model.mahalanobis(eval_x)
        max_d2 = float(np.percentile(dists_sq, 85))
    except Exception:
        dists_sq = np.sum(eval_x**2, axis=1)
        max_d2 = float(np.percentile(dists_sq, 85))

    maha_d = float(math.sqrt(max(0.0, max_d2)))
    cdf_prob = float(chi2.cdf(max_d2, df=d))
    maha_score = float(np.clip((cdf_prob - 0.5) * 200.0 if cdf_prob > 0.5 else 0.0, 0.0, 100.0))

    # 2. River streaming HalfSpaceTrees (learned strictly on past train_x)
    hst = HalfSpaceTrees(n_trees=15, height=5, window_size=48, seed=42)
    # Normalize matrix into [0, 1] scale using sigmoid(z / 2.5)
    norm_train = 1.0 / (1.0 + np.exp(-train_x / 2.0))
    norm_eval = 1.0 / (1.0 + np.exp(-eval_x / 2.0))

    for row in norm_train[-144:]:
        feat = {f"f{k}": float(row[k]) for k in range(d)}
        hst.learn_one(feat)

    hst_scores = []
    for row in norm_eval:
        feat = {f"f{k}": float(row[k]) for k in range(d)}
        hst_scores.append(float(hst.score_one(feat)))
    hst_peak = float(np.percentile(hst_scores, 80)) if hst_scores else 0.0
    hst_scaled = float(np.clip((hst_peak - 0.45) * 165.0, 0.0, 100.0))

    # 3. IsolationForest cross-check
    iso_scaled = 0.0
    try:
        iso = IsolationForest(n_estimators=60, contamination=0.05, random_state=42)
        iso.fit(train_jitter)
        # decision_function returns >0 for inliers, <0 for outliers
        raw_dec = iso.decision_function(eval_x)
        worst = float(np.percentile(-raw_dec, 85))
        iso_scaled = float(np.clip((worst + 0.03) * 240.0, 0.0, 100.0))
    except Exception:
        iso_scaled = 0.0

    # Combine strictly deterministic L3 methods (requiring coherence, not single outlier noise)
    l3_score = float(np.clip(0.50 * maha_score + 0.25 * hst_scaled + 0.25 * iso_scaled, 0.0, 100.0))
    result.update(
        {
            "l3Score": round(l3_score, 2),
            "mahalanobisDistance": round(maha_d, 3),
            "chi2PValue": round(max(1e-6, 1.0 - cdf_prob), 5),
            "halfSpaceTreesScore": round(hst_peak, 4),
            "isolationForestScore": round(iso_scaled, 2),
        }
    )
    return result


def evaluate_patient_window(
    patient_id: str,
    raw_samples: list[dict[str, Any]],
    conditions: list[str] | None = None,
    age: int | None = None,
    exclusions: list[dict[str, Any]] | None = None,
    environment: dict[str, Any] | None = None,
    reference_now: datetime | None = None,
    precomputed_baseline: BaselineModel | None = None,
    fast_mode: bool = False,
) -> dict[str, Any]:
    """Evaluates personal baseline + deterministic 3-layer deterioration detection end-to-end."""
    samples = normalize_samples(raw_samples)
    spans = parse_exclusions(exclusions or [])
    buckets = aggregate_hourly_timeline(samples, spans)

    baseline = precomputed_baseline or fit_personal_baselines(
        patient_id=patient_id,
        buckets=buckets,
        conditions=conditions,
        age=age,
    )

    now_dt = reference_now or (buckets[-1].hour_utc if buckets else datetime.now(timezone.utc))
    is_synthetic = any(s.is_synthetic for s in samples)

    if not buckets:
        return {
            "patientId": patient_id,
            "assessedAt": now_dt.isoformat(),
            "modelVersion": MODEL_VERSION,
            "isSynthetic": is_synthetic,
            "deteriorationIndex": 0.0,
            "level": "stable",
            "baseline": baseline.to_dict(),
            "l1Score": 0.0,
            "l2Score": 0.0,
            "l3Score": 0.0,
            "deviceSilent": True,
            "hoursSilent": None,
            "contributions": [],
            "trend72h": [],
            "changePoints": [],
            "partialNews2": compute_partial_news2({}, baseline.spo2_scale, False),
            "decisionLog": {
                "suppressedConfounders": ["no_telemetry_available"],
                "l1Triggers": [],
                "l3Details": {},
                "weights": baseline.metric_weights,
            },
            "summaryText": "No wearable readings received yet. Upload an export or connect a sensor to begin learning your personal normal.",
        }

    # Determine device silence vs last non-excluded reading
    last_sample_dt = samples[-1].recorded_at
    hours_silent = max(0.0, (now_dt - last_sample_dt).total_seconds() / 3600.0)
    device_silent = hours_silent >= 12.0

    # L1 clinical safety bounds across trailing 12h
    recent_12 = buckets[-12:]
    l1_score, l1_triggers, suppressed = _detect_l1_safety(recent_12, baseline)

    # L2 personal temporal matrix (Z + EWMA + CUSUM + ruptures)
    mat, used_metrics, trace, metric_stats = _compute_hourly_risk_matrix(buckets, baseline)
    change_points = [] if fast_mode else _detect_changepoints(buckets, trace)

    # Also score supplemental non-matrix metrics (bp, weight, sleep, body_temp, afib_burden) in trailing 24h
    extra_metrics = [
        m
        for m in (
            "systolic_bp",
            "weight_kg",
            "sleep_efficiency",
            "sleep_duration_min",
            "sleep_awakenings",
            "body_temperature",
            "blood_glucose",
            "afib_burden",
        )
        if m in baseline.metrics
    ]
    trailing_24 = buckets[-24:]
    for m in extra_metrics:
        mb = baseline.metrics[m]
        vals = [(b, b.metrics[m]) for b in trailing_24 if m in b.metrics]
        if vals:
            b_last, v_last = vals[-1]
            _, rz, _ = _signed_z(m, v_last, mb.expected_for(b_last.circadian_block, b_last.is_weekend), mb.sigma)
            metric_stats[m] = {
                "lastZ": rz,
                "ewmaZ": rz,
                "cusum": max(0.0, (rz - 0.8) * min(3.0, len(vals))),
                "maxRecentZ": rz,
            }

    # Compute L2 score per metric & aggregate top drivers
    contributions: list[dict[str, Any]] = []
    weighted_l2_terms: list[float] = []

    latest_metrics_merged: dict[str, float] = {}
    for b in reversed(buckets[-12:]):
        for k, v in b.metrics.items():
            latest_metrics_merged.setdefault(k, v)

    active_confounders = list(suppressed)
    heat_level = str((environment or {}).get("heatRiskLevel") or "normal")
    apparent_temp = (environment or {}).get("apparentTempC")
    heat_confounder = heat_level in ("high", "extreme") or (apparent_temp is not None and float(apparent_temp) >= 34.0)
    if heat_confounder:
        active_confounders.append("ambient_heat_stress_context")

    last_bucket = buckets[-1]
    exercise_recent = (
        "exercise" in last_bucket.contexts
        and last_bucket.metrics.get("steps", 0.0) >= 40.0
    )
    if exercise_recent:
        active_confounders.append("active_exercise_suppressed")

    for m, st in metric_stats.items():
        mb = baseline.metrics.get(m)
        obs = latest_metrics_merged.get(m)
        if mb is None or obs is None:
            continue

        cond_w = baseline.metric_weights.get(m, 1.0)
        z_eff = max(st["ewmaZ"], 0.65 * st["maxRecentZ"])
        cusum_eff = st["cusum"]

        # Gentle ambient-heat attenuation ONLY if heat is high & this is mild resting HR/temp without respiratory/SpO2 shift
        if heat_confounder and m in ("resting_heart_rate", "skin_temp_deviation") and z_eff < 2.2:
            z_eff *= 0.85

        signal_score = cond_w * (16.5 * z_eff + 4.8 * cusum_eff)
        weighted_l2_terms.append(signal_score)

        raw_z, _, dir_label = _signed_z(m, obs, mb.median, mb.sigma)
        low, high = mb.normal_range(1.6)
        label, unit = FRIENDLY_METRIC_NAMES.get(m, (m, ""))
        if dir_label == "normal" or z_eff < 0.7:
            msg = f"{label} ({obs:.1f} {unit}) is within your personal normal ({low:.1f}–{high:.1f})."
        elif dir_label in ("higher", "erratic_high"):
            msg = f"{label} ({obs:.1f} {unit}) is higher than your personal normal ({low:.1f}–{high:.1f})."
        else:
            msg = f"{label} ({obs:.1f} {unit}) is lower than your personal normal ({low:.1f}–{high:.1f})."

        contributions.append(
            {
                "metricType": m,
                "label": label,
                "unit": unit,
                "observed": round(obs, 2),
                "personalMedian": round(mb.median, 2),
                "normalLow": round(low, 2),
                "normalHigh": round(high, 2),
                "zScore": round(raw_z, 2),
                "ewmaZ": round(st["ewmaZ"], 2),
                "cusum": round(st["cusum"], 2),
                "direction": dir_label,
                "rawContribution": round(signal_score, 2),
                "sharePct": 0.0,
                "message": msg,
            }
        )

    contributions.sort(key=lambda c: c["rawContribution"], reverse=True)
    total_raw = sum(max(0.0, c["rawContribution"]) for c in contributions)
    if total_raw > 0:
        for c in contributions:
            c["sharePct"] = round(100.0 * max(0.0, c["rawContribution"]) / total_raw, 1)

    top_l2_sorted = sorted(weighted_l2_terms, reverse=True)
    l2_core = sum(top_l2_sorted[:3]) / max(1.0, min(3.0, len(top_l2_sorted))) if top_l2_sorted else 0.0
    # Multi-signal synergy boost when >=2 metrics cross meaningful drift concurrently
    coincident_signals = sum(1 for c in contributions if c["rawContribution"] >= 20.0)
    if coincident_signals >= 2:
        l2_core *= 1.0 + 0.14 * min(3, coincident_signals - 1)
    l2_score = float(np.clip(l2_core, 0.0, 100.0))

    # L3 multivariate score
    split_idx = max(18, len(buckets) - 48)
    l3_info = (
        {"l3Score": 0.0, "mahalanobisDistance": 0.0, "chi2PValue": 1.0, "halfSpaceTreesScore": 0.0, "isolationForestScore": 0.0, "autoencoderScore": None, "autoencoderStatus": "skipped_fast_mode"}
        if fast_mode
        else _evaluate_l3_multivariate(mat, split_idx)
    )
    l3_score = float(l3_info["l3Score"])

    # Fall-pattern check: acute mid-day tachycardia burst followed by unexpected zero steps & silence
    steps_trailing_12 = [b.metrics.get("steps", 0.0) for b in recent_12 if "steps" in b.metrics]
    acute_hr_spike = any(
        b.metrics.get("heart_rate", 0.0) >= 122.0 and b.metrics.get("steps", 0.0) <= 5.0
        for b in recent_12
    )
    if acute_hr_spike and (not steps_trailing_12 or min(steps_trailing_12[-2:]) == 0.0) and hours_silent >= 3.0:
        l1_score = max(l1_score, 68.0)
        l1_triggers.append(
            {
                "rule": "inactivity_after_acute_hr_spike",
                "detail": "Acute calm HR elevation followed by sudden stillness / data stop",
                "severity": "warning",
            }
        )

    # Confidence attenuation if average recent wear quality is poor
    recent_conf = float(np.mean([b.mean_confidence for b in buckets[-6:]]))
    quality_factor = 0.78 if recent_conf < 0.55 else 1.0

    # Calibrated Fusion -> 0..100 Deterioration Index
    # If calm resting history has zero exercise interference, blend peak safety L1 + sustained L2 + multivariate L3
    fused = max(
        l1_score,
        quality_factor * (0.30 * l1_score + 0.50 * l2_score + 0.20 * l3_score),
    )

    if len(change_points) >= 1 and l2_score >= 28.0:
        fused = min(100.0, fused + 5.0)

    # Device silence elevates to at least `watch` operational check without exaggerating clinical severity
    if device_silent and fused < 32.0:
        fused = 34.0

    deterioration_index = round(float(np.clip(fused, 0.0, 100.0)), 1)

    if deterioration_index >= 80.0 or l1_score >= 82.0:
        level = "urgent"
    elif deterioration_index >= 55.0:
        level = "warning"
    elif deterioration_index >= 30.0 or device_silent:
        level = "watch"
    else:
        level = "stable"

    # Build 72h composite risk trend curve for clinician dashboard
    trend72h: list[dict[str, Any]] = []
    if trace:
        start_idx = max(0, len(buckets) - 72)
        for idx in range(start_idx, len(buckets)):
            b = buckets[idx]
            strain = float(np.clip(trace[idx] * 26.0, 0.0, 100.0))
            trend72h.append(
                {
                    "timestamp": b.hour_utc.isoformat(),
                    "score": round(strain, 1),
                    "confidence": round(b.mean_confidence, 2),
                    "excluded": b.excluded,
                }
            )

    partial_news2 = compute_partial_news2(
        latest_metrics_merged,
        spo2_scale=baseline.spo2_scale,
        is_exercise_context=exercise_recent,
    )

    top_drivers = [c["label"] for c in contributions[:3] if c["rawContribution"] >= 14.0]
    if level == "stable":
        summary_text = (
            f"Readings look consistent with your personal normal ({baseline.status_label})."
        )
    elif device_silent and not top_drivers:
        summary_text = (
            f"No wearable readings received for {hours_silent:.0f}h — check watch battery or fit."
        )
    else:
        driver_str = ", ".join(top_drivers) if top_drivers else "combined patterns"
        summary_text = (
            f"Notable changes from your personal normal in {driver_str}. "
            "Early awareness signal only — check how the person feels or contact a doctor if unwell."
        )

    return {
        "patientId": patient_id,
        "assessedAt": now_dt.isoformat(),
        "modelVersion": MODEL_VERSION,
        "isSynthetic": is_synthetic,
        "deteriorationIndex": deterioration_index,
        "level": level,
        "baseline": baseline.to_dict(),
        "l1Score": round(l1_score, 2),
        "l2Score": round(l2_score, 2),
        "l3Score": round(l3_score, 2),
        "deviceSilent": device_silent,
        "hoursSilent": round(hours_silent, 2),
        "contributions": contributions[:8],
        "trend72h": trend72h,
        "changePoints": change_points,
        "partialNews2": partial_news2,
        "decisionLog": {
            "suppressedConfounders": active_confounders,
            "l1Triggers": l1_triggers,
            "l3Details": l3_info,
            "recentConfidence": round(recent_conf, 3),
            "weights": baseline.metric_weights,
        },
        "summaryText": summary_text,
    }
