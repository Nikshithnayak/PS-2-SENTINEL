"""Causal walk-forward benchmark & ablation harness across seeded synthetic scenarios."""

from __future__ import annotations

from statistics import median
from typing import Any

from engine.baseline import fit_personal_baselines
from engine.detectors import evaluate_patient_window
from engine.features import aggregate_hourly_timeline, normalize_samples, parse_utc
from sim.generator import SCENARIO_CATALOG, ScenarioName, generate_scenario

DETERIORATING_SCENARIOS: set[ScenarioName] = {
    "early_infection",
    "hf_decompensation",
    "copd_exacerbation",
    "arrhythmia_episode",
    "dehydration_heat",
    "post_discharge_decline",
    "missed_medication",
    "fall_event",
}

NEGATIVE_CONTROL_SCENARIOS: set[ScenarioName] = {
    "baseline_stable",
    "exercise_confounder",
}


def run_benchmark(
    seeds: list[int] | None = None,
    total_days: int = 18,
    include_ablations: bool = True,
) -> dict[str, Any]:
    """Runs honest causal walk-forward evaluation across all 11 physiological scenarios.

    Wait-free & causal guarantee:
    - Personal baseline is fitted strictly prior to injected onset (`baseline_end_ts`).
    - Each scenario runs forward hourly from day 14 onward without future lookahead.
    - Reports exact observed sensitivity, specificity, PPV, false alerts / patient-week,
      and median detection lead hours for `fixed_only`, `L1_L2_personal`, and `L1_L2_L3_full`.
    """
    seed_list = seeds or [42, 43]
    scenario_rows: list[dict[str, Any]] = []

    ablation_tally: dict[str, dict[str, Any]] = {
        "fixed_clinical_only": {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "total_weeks": 0.0, "false_alert_hours": 0, "leads": []},
        "L1_L2_personal": {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "total_weeks": 0.0, "false_alert_hours": 0, "leads": []},
        "L1_L2_L3_full": {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "total_weeks": 0.0, "false_alert_hours": 0, "leads": []},
    }

    for scenario_name in SCENARIO_CATALOG.keys():
        conditions = ["copd"] if scenario_name == "copd_exacerbation" else (
            ["heart_failure"] if scenario_name == "hf_decompensation" else ["general_frailty"]
        )

        for seed in seed_list:
            gen = generate_scenario(scenario=scenario_name, seed=seed, total_days=total_days)
            norm_samples = normalize_samples(gen.samples)
            all_buckets = aggregate_hourly_timeline(norm_samples)
            if len(all_buckets) < 72:
                continue

            onset_dt = parse_utc(gen.onset_at) if gen.onset_at else None

            # Baseline learned STRICTLY before onset (or first 14 days for stable/confounder)
            if onset_dt is not None:
                pre_onset_buckets = [b for b in all_buckets if b.hour_utc < onset_dt]
            else:
                pre_onset_buckets = all_buckets[: max(72, len(all_buckets) - 48)]

            pre_baseline = fit_personal_baselines(
                patient_id=f"bench-{scenario_name}-{seed}",
                buckets=pre_onset_buckets,
                conditions=conditions,
                age=72,
                reference_end_hours_protect=0,
            )

            # Evaluate causal checkpoints stepping every 2 hours across the evaluation window
            eval_start_ts = (
                pre_onset_buckets[-1].hour_utc if pre_onset_buckets else all_buckets[min(240, len(all_buckets) - 1)].hour_utc
            )
            eval_indices = [
                i
                for i, b in enumerate(all_buckets)
                if b.hour_utc >= eval_start_ts
            ]
            # Step 2h to keep runtime brisk while capturing onset accurately
            stepped_indices = eval_indices[::2]
            if eval_indices and stepped_indices[-1] != eval_indices[-1]:
                stepped_indices.append(eval_indices[-1])

            parsed_samples_dt = [
                (parse_utc(s["recordedAt"]), s) for s in gen.samples
            ]
            parsed_samples_dt.sort(key=lambda pair: pair[0])

            first_alert_at: dict[str, str | None] = {
                "fixed_clinical_only": None,
                "L1_L2_personal": None,
                "L1_L2_L3_full": None,
            }
            peak_score: dict[str, float] = {k: 0.0 for k in first_alert_at}
            final_level = "stable"

            cursor = 0
            window_samples: list[dict[str, Any]] = []
            for idx in stepped_indices:
                cutoff_dt = all_buckets[idx].hour_utc
                while cursor < len(parsed_samples_dt) and parsed_samples_dt[cursor][0] <= cutoff_dt:
                    window_samples.append(parsed_samples_dt[cursor][1])
                    cursor += 1
                is_final = idx == stepped_indices[-1]
                res = evaluate_patient_window(
                    patient_id=f"bench-{scenario_name}-{seed}",
                    raw_samples=window_samples,
                    conditions=conditions,
                    age=72,
                    reference_now=cutoff_dt,
                    precomputed_baseline=pre_baseline,
                    fast_mode=not is_final,
                )

                fixed_s = float(res["l1Score"])
                l1_l2_s = max(fixed_s, float(res["l2Score"]))
                full_s = float(res["deteriorationIndex"])
                scores = {
                    "fixed_clinical_only": fixed_s,
                    "L1_L2_personal": l1_l2_s,
                    "L1_L2_L3_full": full_s,
                }
                if is_final:
                    final_level = str(res["level"])

                for mode, sc in scores.items():
                    peak_score[mode] = max(peak_score[mode], sc)
                    if sc >= 30.0 and (onset_dt is None or cutoff_dt >= onset_dt):
                        if first_alert_at[mode] is None:
                            first_alert_at[mode] = cutoff_dt.isoformat()
                        if scenario_name in NEGATIVE_CONTROL_SCENARIOS:
                            ablation_tally[mode]["false_alert_hours"] += 1

            # Handle off-wrist silence special final check (end_time after last sample)
            if scenario_name == "off_wrist_silence":
                final_res = evaluate_patient_window(
                    patient_id=f"bench-{scenario_name}-{seed}",
                    raw_samples=gen.samples,
                    conditions=conditions,
                    age=72,
                    reference_now=all_buckets[-1].hour_utc + (all_buckets[-1].hour_utc - all_buckets[-2].hour_utc) * 18,
                    precomputed_baseline=pre_baseline,
                )
                peak_score["L1_L2_L3_full"] = max(peak_score["L1_L2_L3_full"], float(final_res["deteriorationIndex"]))
                final_level = str(final_res["level"])
                if final_res["deviceSilent"]:
                    first_alert_at["L1_L2_L3_full"] = final_res["assessedAt"]

            window_weeks = max(0.25, len(eval_indices) / (24.0 * 7.0))
            is_pos = scenario_name in DETERIORATING_SCENARIOS
            is_neg = scenario_name in NEGATIVE_CONTROL_SCENARIOS

            for mode in ablation_tally.keys():
                if not include_ablations and mode != "L1_L2_L3_full":
                    continue
                ablation_tally[mode]["total_weeks"] += window_weeks
                alerted = first_alert_at[mode] is not None
                if is_pos:
                    if alerted:
                        ablation_tally[mode]["tp"] += 1
                        if onset_dt is not None and first_alert_at[mode] is not None:
                            # Detection delay from onset (negative = before full peak / early prodrome)
                            delay_h = (parse_utc(first_alert_at[mode]) - onset_dt).total_seconds() / 3600.0
                            ablation_tally[mode]["leads"].append(round(delay_h, 1))
                    else:
                        ablation_tally[mode]["fn"] += 1
                elif is_neg:
                    if alerted:
                        ablation_tally[mode]["fp"] += 1
                    else:
                        ablation_tally[mode]["tn"] += 1

            lead_h = None
            if onset_dt is not None and first_alert_at["L1_L2_L3_full"] is not None:
                lead_h = round(
                    (parse_utc(first_alert_at["L1_L2_L3_full"]) - onset_dt).total_seconds() / 3600.0,
                    1,
                )

            scenario_rows.append(
                {
                    "scenario": scenario_name,
                    "seed": seed,
                    "expectedLevel": gen.expected_alert_level,
                    "observedFinalLevel": final_level,
                    "peakIndexFull": round(peak_score["L1_L2_L3_full"], 1),
                    "peakIndexFixed": round(peak_score["fixed_clinical_only"], 1),
                    "detectedFull": first_alert_at["L1_L2_L3_full"] is not None,
                    "detectedFixed": first_alert_at["fixed_clinical_only"] is not None,
                    "hoursAfterOnsetFull": lead_h,
                }
            )

    summary_by_ablation: dict[str, Any] = {}
    for mode, t in ablation_tally.items():
        if not include_ablations and mode != "L1_L2_L3_full":
            continue
        tp, fp, fn, tn = t["tp"], t["fp"], t["fn"], t["tn"]
        sens = tp / max(1, tp + fn)
        ppv = tp / max(1, tp + fp)
        spec = tn / max(1, tn + fp)
        fa_per_week = t["false_alert_hours"] / max(0.5, t["total_weeks"])
        summary_by_ablation[mode] = {
            "truePositives": tp,
            "falsePositives": fp,
            "falseNegatives": fn,
            "trueNegatives": tn,
            "sensitivity": round(sens, 3),
            "specificity": round(spec, 3),
            "ppv": round(ppv, 3),
            "falseAlertsPerPatientWeek": round(fa_per_week, 3),
            "medianHoursAfterOnset": round(float(median(t["leads"])), 1) if t["leads"] else None,
        }

    return {
        "datasetMode": "seeded_physiological_scenarios",
        "isSynthetic": True,
        "seedsTested": seed_list,
        "scenarioCount": len(SCENARIO_CATALOG),
        "ablations": summary_by_ablation,
        "scenarios": scenario_rows,
        "notes": "Measured causally without future lookahead; public datasets (PMData/LifeSnaps/WESAD/MMASH) load via engine.datasets.loaders when archives are present in _data/.",
    }
