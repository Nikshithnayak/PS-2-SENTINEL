"""Contamination-quarantined personal baseline fitter with 14-day shrinkage & circadian offsets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from engine.conditions import get_priors_for_conditions
from engine.features import MIN_SIGMA_FLOOR, HourlyBucket


@dataclass
class MetricBaseline:
    metric_type: str
    context: str
    sample_count: int
    valid_days: int
    stage: str  # warming_prior | learning | calibrated
    median: float
    mad: float
    sigma: float
    ewma_mean: float
    ewma_var: float
    prior_mean: float
    prior_sd: float
    shrinkage_weight: float
    hourly_offsets: dict[str, float]  # night, morning, afternoon, evening
    weekday_offset: float
    weekend_offset: float
    quarantined_points: int
    baseline_version: str = "sentinel-baseline-v1"

    def expected_for(self, circadian_block: str, is_weekend: bool) -> float:
        circ = self.hourly_offsets.get(circadian_block, 0.0)
        wk = self.weekend_offset if is_weekend else self.weekday_offset
        return self.median + circ + wk

    def normal_range(self, z_band: float = 2.0) -> tuple[float, float]:
        return (self.median - z_band * self.sigma, self.median + z_band * self.sigma)

    def to_dict(self) -> dict[str, Any]:
        low, high = self.normal_range(1.6)
        return {
            "metricType": self.metric_type,
            "context": self.context,
            "sampleCount": self.sample_count,
            "validDays": self.valid_days,
            "stage": self.stage,
            "median": round(self.median, 4),
            "mad": round(self.mad, 4),
            "sigma": round(self.sigma, 4),
            "ewmaMean": round(self.ewma_mean, 4),
            "ewmaVar": round(self.ewma_var, 4),
            "priorMean": round(self.prior_mean, 4),
            "priorSd": round(self.prior_sd, 4),
            "shrinkageWeight": round(self.shrinkage_weight, 4),
            "hourlyOffsets": {k: round(v, 4) for k, v in self.hourly_offsets.items()},
            "weekdayOffset": round(self.weekday_offset, 4),
            "weekendOffset": round(self.weekend_offset, 4),
            "normalLow": round(low, 2),
            "normalHigh": round(high, 2),
            "quarantinedPoints": self.quarantined_points,
            "baselineVersion": self.baseline_version,
        }


@dataclass
class BaselineModel:
    patient_id: str
    total_span_days: int
    valid_days: int
    stage: str
    status_label: str
    conditions: list[str]
    spo2_scale: int
    metric_weights: dict[str, float]
    metrics: dict[str, MetricBaseline]

    def to_dict(self) -> dict[str, Any]:
        return {
            "patientId": self.patient_id,
            "totalSpanDays": self.total_span_days,
            "validDays": self.valid_days,
            "stage": self.stage,
            "statusLabel": self.status_label,
            "conditions": self.conditions,
            "spo2Scale": self.spo2_scale,
            "metrics": [m.to_dict() for m in self.metrics.values()],
        }


def _weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    if len(values) == 0:
        return 0.0
    if len(values) == 1:
        return float(values[0])
    order = np.argsort(values)
    v_s = values[order]
    w_s = np.maximum(weights[order], 1e-6)
    cum = np.cumsum(w_s) / np.sum(w_s)
    idx = int(np.searchsorted(cum, 0.5))
    idx = min(idx, len(v_s) - 1)
    return float(v_s[idx])


def fit_personal_baselines(
    patient_id: str,
    buckets: list[HourlyBucket],
    conditions: list[str] | None = None,
    age: int | None = None,
    reference_end_hours_protect: int = 48,
) -> BaselineModel:
    """Fits per-person robust baselines with contamination quarantine & shrinkage warm-up.

    Contamination Quarantine rules:
    1. Any hourly bucket overlapping user-defined `excluded_periods` is skipped.
    2. When >= 10 days exist, the most recent `reference_end_hours_protect` hours are held out
       from location/scale estimation so an acute active deterioration episode cannot shift
       its own healthy normal upward before triggering an alert!
    3. Points exceeding 3.5 * MAD during initial fit are quarantined out of refined median/MAD.
    """
    cond_list = conditions or ["general_frailty"]
    priors, weights, spo2_scale = get_priors_for_conditions(cond_list, age=age)

    if not buckets:
        metrics = {}
        for m, (p_mean, p_sd) in priors.items():
            metrics[m] = MetricBaseline(
                metric_type=m,
                context="calm_all",
                sample_count=0,
                valid_days=0,
                stage="warming_prior",
                median=p_mean,
                mad=p_sd / 1.4826,
                sigma=max(p_sd, MIN_SIGMA_FLOOR.get(m, 1.0)),
                ewma_mean=p_mean,
                ewma_var=p_sd**2,
                prior_mean=p_mean,
                prior_sd=p_sd,
                shrinkage_weight=0.0,
                hourly_offsets={"night": 0.0, "morning": 0.0, "afternoon": 0.0, "evening": 0.0},
                weekday_offset=0.0,
                weekend_offset=0.0,
                quarantined_points=0,
            )
        return BaselineModel(
            patient_id=patient_id,
            total_span_days=0,
            valid_days=0,
            stage="warming_prior",
            status_label="Learning, day 0 of 14 (population prior anchored)",
            conditions=cond_list,
            spo2_scale=spo2_scale,
            metric_weights=weights,
            metrics=metrics,
        )

    latest_ts = buckets[-1].hour_utc
    earliest_ts = buckets[0].hour_utc
    span_days = max(1, int((latest_ts - earliest_ts).total_seconds() // 86400) + 1)

    non_excluded = [b for b in buckets if not b.excluded]
    unique_days = {b.hour_utc.date() for b in non_excluded}
    valid_days = len(unique_days)

    # Hold out tail window when we already have substantial history so slow acute onset never contaminates healthy normal.
    if span_days >= 10 and len(non_excluded) > reference_end_hours_protect + 72:
        cutoff_ts_sec = latest_ts.timestamp() - reference_end_hours_protect * 3600.0
        fit_buckets = [b for b in non_excluded if b.hour_utc.timestamp() <= cutoff_ts_sec]
        if len(fit_buckets) < 72:
            fit_buckets = non_excluded
    else:
        fit_buckets = non_excluded

    if valid_days >= 14 or (span_days >= 14 and valid_days >= 10):
        global_stage = "calibrated"
        status_label = f"Calibrated to personal normal ({valid_days} valid days)"
    elif valid_days >= 3:
        global_stage = "learning"
        status_label = f"Learning, day {min(valid_days, 14)} of 14"
    else:
        global_stage = "warming_prior"
        status_label = f"Learning, day {valid_days} of 14 (population prior anchored)"

    metric_baselines: dict[str, MetricBaseline] = {}
    all_metric_names = sorted(set(priors.keys()) | {m for b in fit_buckets for m in b.metrics.keys()})

    for m in all_metric_names:
        prior_mean, prior_sd = priors.get(m, (50.0, 10.0))
        floor_sigma = MIN_SIGMA_FLOOR.get(m, 1.0)

        rows: list[tuple[HourlyBucket, float, float]] = []
        for b in fit_buckets:
            if m in b.metrics:
                # Skip explicit daytime exercise spikes for calm baseline metrics
                if m in ("resting_heart_rate", "heart_rate", "respiratory_rate") and "exercise" in b.contexts and len(b.contexts) == 1:
                    continue
                conf = float(b.metric_confidences.get(m, b.mean_confidence))
                if m == "steps" and b.circadian_block == "night":
                    continue
                rows.append((b, b.metrics[m], conf))

        m_days = len({r[0].hour_utc.date() for r in rows})
        # Empirical Bayes shrinkage toward prior during warm-up (k=5 days -> weight 0.74 at day 14)
        shrink_w = float(m_days / (m_days + 5.0)) if m_days > 0 else 0.0
        if m_days >= 14:
            shrink_w = float(min(0.95, shrink_w))

        if len(rows) < 6:
            metric_baselines[m] = MetricBaseline(
                metric_type=m,
                context="calm_all",
                sample_count=len(rows),
                valid_days=m_days,
                stage="warming_prior" if m_days < 3 else "learning",
                median=prior_mean,
                mad=prior_sd / 1.4826,
                sigma=max(prior_sd, floor_sigma),
                ewma_mean=prior_mean,
                ewma_var=prior_sd**2,
                prior_mean=prior_mean,
                prior_sd=prior_sd,
                shrinkage_weight=shrink_w,
                hourly_offsets={"night": 0.0, "morning": 0.0, "afternoon": 0.0, "evening": 0.0},
                weekday_offset=0.0,
                weekend_offset=0.0,
                quarantined_points=0,
            )
            continue

        vals = np.asarray([r[1] for r in rows], dtype=float)
        confs = np.asarray([r[2] for r in rows], dtype=float)

        med_raw = _weighted_median(vals, confs)
        abs_dev = np.abs(vals - med_raw)
        mad_raw = max(float(np.median(abs_dev)), floor_sigma / 1.4826)
        sigma_raw = max(1.4826 * mad_raw, floor_sigma)

        # Contamination quarantine pass: mask transient outliers (>3.5 sigma) before refined fit
        inlier_mask = np.abs(vals - med_raw) <= 3.5 * sigma_raw
        quarantined = int(np.sum(~inlier_mask))
        clean_rows = [r for r, keep in zip(rows, inlier_mask) if keep]
        if len(clean_rows) < 4:
            clean_rows = rows
            quarantined = 0

        c_vals = np.asarray([r[1] for r in clean_rows], dtype=float)
        c_confs = np.asarray([r[2] for r in clean_rows], dtype=float)

        med_person = _weighted_median(c_vals, c_confs)
        mad_person = float(np.median(np.abs(c_vals - med_person)))
        sigma_person = max(1.4826 * mad_person, floor_sigma)

        # Shrinkage combination
        post_mean = shrink_w * med_person + (1.0 - shrink_w) * prior_mean
        post_sigma = max(shrink_w * sigma_person + (1.0 - shrink_w) * prior_sd, floor_sigma)
        post_mad = post_sigma / 1.4826

        # Slow forgetting EWMA over quarantined trajectory
        alpha = 0.025
        ewma = post_mean
        ewma_var = post_sigma**2
        for _, v, w in clean_rows:
            eff_a = alpha * w
            ewma = (1.0 - eff_a) * ewma + eff_a * v
            ewma_var = (1.0 - eff_a) * ewma_var + eff_a * ((v - ewma) ** 2)

        # Circadian & weekday adjustments (damped by sample size so noise doesn't overfit)
        circ_offsets: dict[str, float] = {}
        for block in ("night", "morning", "afternoon", "evening"):
            b_vals = np.asarray(
                [v for b, v, _ in clean_rows if b.circadian_block == block], dtype=float
            )
            if len(b_vals) >= 4:
                raw_diff = float(np.median(b_vals) - post_mean)
                damp = len(b_vals) / (len(b_vals) + 12.0)
                circ_offsets[block] = float(np.clip(raw_diff * damp, -2.0 * post_sigma, 2.0 * post_sigma))
            else:
                circ_offsets[block] = 0.0

        wkday_vals = np.asarray([v for b, v, _ in clean_rows if not b.is_weekend], dtype=float)
        wkend_vals = np.asarray([v for b, v, _ in clean_rows if b.is_weekend], dtype=float)
        wkday_off = (
            float(np.clip((np.median(wkday_vals) - post_mean) * 0.4, -post_sigma, post_sigma))
            if len(wkday_vals) >= 6
            else 0.0
        )
        wkend_off = (
            float(np.clip((np.median(wkend_vals) - post_mean) * 0.4, -post_sigma, post_sigma))
            if len(wkend_vals) >= 4
            else 0.0
        )

        m_stage = (
            "calibrated"
            if m_days >= 14
            else ("learning" if m_days >= 3 else "warming_prior")
        )
        metric_baselines[m] = MetricBaseline(
            metric_type=m,
            context="calm_all",
            sample_count=len(clean_rows),
            valid_days=m_days,
            stage=m_stage,
            median=post_mean,
            mad=post_mad,
            sigma=post_sigma,
            ewma_mean=float(ewma),
            ewma_var=float(max(ewma_var, floor_sigma**2)),
            prior_mean=prior_mean,
            prior_sd=prior_sd,
            shrinkage_weight=shrink_w,
            hourly_offsets=circ_offsets,
            weekday_offset=wkday_off,
            weekend_offset=wkend_off,
            quarantined_points=quarantined,
        )

    return BaselineModel(
        patient_id=patient_id,
        total_span_days=span_days,
        valid_days=valid_days,
        stage=global_stage,
        status_label=status_label,
        conditions=cond_list,
        spo2_scale=spo2_scale,
        metric_weights=weights,
        metrics=metric_baselines,
    )
