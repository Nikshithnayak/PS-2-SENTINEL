# Sachet · SENTINEL — Baseline, 3-Layer Detection & Validation Report

**Reference Implementations Audited:**
- Python FastAPI Engine: `services/engine/engine/baseline.py`, `features.py`, `conditions.py`, `detectors.py`, `eval_harness.py`, `sim/generator.py`
- TypeScript Serverless Engine (`VERCEL=1` deterministic parity): `apps/web/src/lib/engine/ts-fallback.ts`, `apps/web/src/lib/engine/client.ts`
- Benchmark Fallback (`VERCEL=1` without `ENGINE_URL`): `apps/web/src/lib/engine/benchmark-fallback.ts`

---

## 1. Personal Baseline Methodology & Verification

| Requirement | Python Engine Implementation | TypeScript Parity Implementation | Verified Evidence |
|---|---|---|---|
| **14-Day Calibration Progression** | `baseline.py` computes unique valid calendar days -> `warming_prior` (`<3d`), `learning` (`3..13d`), `calibrated` (`>=14d`) | `ts-fallback.ts` (`mDays >= 14 ? 'calibrated' : mDays >= 3 ? 'learning' : 'warming_prior'`) | `ps2-verification.test.ts` verified 2d (`warming_prior`), 7d (`learning`), 15d (`calibrated`) |
| **Context Separation & Calm Backfill** | `features.py` separates `sleep`, `rest`, `light_activity`, `exercise`; backfills `resting_heart_rate` from calm `heart_rate`; excludes pure `exercise` for HR/RHR/RR and `night` blocks for `steps` | `ts-fallback.ts` mirrors hourly rollup, calm `heart_rate -> resting_heart_rate` backfill, isolated `exercise` exclusion, and `night` step exclusion | `ps2-verification.test.ts` & `test_engine.py` verified isolated `142 bpm` `exercise` session does not shift resting baseline |
| **Weighted Median & `1.4826 * MAD`** | Confidence-weighted median + `1.4826 * MAD` clamped by `MIN_SIGMA_FLOOR` + 3.5-sigma trim | Identical weighted median, `1.4826 * MAD`, `MIN_SIGMA_FLOOR`, 3.5-sigma trim | Verified in `ts-fallback.ts` lines 645–662 & `baseline.py` |
| **Empirical Bayes Shrinkage** | `w = min(0.95, valid_days / (valid_days + 5.0))` blends personal location/scale with age/sex & condition priors | `shrinkW = min(0.95, mDays / (mDays + 5))` blends against `conditionWeights(conditions)` priors | Verified in `ps2-verification.test.ts` (15d personal 63–65 bpm shrinks toward personal mean vs 66 prior) |
| **Contamination Quarantine (`excluded_periods`)** | `baseline.py` excludes flagged hours & tail acute window (`span >= 10d` -> exclude trailing 48h when `>= 72h` remain) | `ts-fallback.ts` excludes `[startsAt, endsAt]` spans and trailing 48h acute window identically | `test_contamination_quarantine_and_excluded_periods` (pytest) & `ps2-verification.test.ts` (`118 bpm` day-6 illness excluded) |

---

## 2. Three-Layer Detection Architecture Verification

1. **L1 — Clinical Safety Bounds & Partial NEWS2:**
   - Enforces NEWS2-aligned thresholds (`resting_pulse`, `respiratory_rate`, `spo2` Scale 1 & COPD Scale 2) with explicit confounder suppression for active exercise (`steps >= 40`).
   - Partial NEWS2 explicitly labels missing parameters (`temperature`, `systolic_bp`, `consciousness_acvpu`, `supplemental_o2`) as `unavailable_from_wearable` and reports `scoredParameterCount / 7` so incomplete wearable sets are never represented as complete NEWS2.
2. **L2 — Personal Temporal Detectors (No Future Leakage):**
   - Strictly causal prefix scoring over chronologically sorted hourly buckets: directional Z-score (`RISK_DIRECTION`), EWMA (`lambda = 0.25`), one-sided Page-Hinkley/CUSUM accumulator, and change-point detection (`ruptures.Pelt(model="rbf", pen=4)` in Python; rolling 18h-pre vs 12h-post mean-shift localized `changePoints` in TS).
3. **L3 — Multivariate Coherence & Confounder Attenuation:**
   - **Python Engine:** Fits `MinCovDet` / `LedoitWolf` robust Mahalanobis distance, `IsolationForest` (`n_estimators=100`), and `river.anomaly.HalfSpaceTrees` (`n_trees=15`, `height=6`) across `resting_heart_rate`, `hrv_rmssd`, `spo2`, `respiratory_rate`, `skin_temp_deviation`, and `steps` (requires `>= 24` valid baseline rows & `>= 2` active multivariate columns). Neural autoencoder remains off by default (`ENABLE_AUTOENCODER_L3=false`).
   - **TypeScript Serverless Engine (`ts-fallback.ts`):** Uses diagonal robust Mahalanobis distance + multi-signal coherence count + exercise/ambient heat confounder attenuation + quality/confidence weighting (`recentConf < 0.55 -> 0.78x`) when Python is unattached. Note: `ts-fallback.ts` does NOT run sklearn `IsolationForest` or River `HalfSpaceTrees`; full tree/covariance models require running the Python `services/engine` microservice via `ENGINE_URL`.

---

## 3. Measured Causal Walk-Forward Benchmark Results (Synthetic Only)

**Executed Command:**
```powershell
cd d:\build4manglore\services\engine
uv run python -c "import json; from engine.eval_harness import run_benchmark; res = run_benchmark(seeds=[42, 43], total_days=18, include_ablations=True); print('BENCH_JSON:', json.dumps(res, indent=2))"
```

**Dataset Nature:** `seeded_physiological_scenarios` (`isSynthetic: true`, 11 scenarios x 2 seeds = 22 simulated timelines, 18 days each, causal evaluation strictly without future lookahead). Public datasets (`PMData`, `LifeSnaps`, `WESAD`, `MMASH`) have format adapters in `services/engine/engine/datasets/loaders.py`, **NOT executed against external `_data/` downloads** in this repo (no local dataset archive present).

| Engine Ablation Mode | TP | FP | FN | TN | Sensitivity | Specificity | PPV | False Alerts / Patient-Wk | Median Lead Time After Onset |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `fixed_clinical_only` (L1 static only) | 9 | 0 | 7 | 4 | 0.562 | 1.000 | 1.000 | 0.000 | 3.0 h |
| `L1_L2_personal` (No multivariate suppression) | 14 | 1 | 2 | 3 | 0.875 | 0.750 | 0.933 | 0.137 | 3.0 h |
| `L1_L2_L3_full` (Full Python 3-Layer Engine) | 14 | 0 | 2 | 4 | **0.875** | **1.000** | **1.000** | **0.000** | **9.0 h** |

**Per-Scenario Honest Breakdown (2 Seeds Each, `L1_L2_L3_full`):**
- `baseline_stable`: Seed 42/43 observed `stable` (peak `19.4` / `19.0`) -> True Negative.
- `exercise_confounder`: Seed 42/43 observed `stable` (peak `17.7` / `14.3` vs fixed `0.0`) -> True Negative (correctly suppressed).
- `early_infection`, `hf_decompensation`, `copd_exacerbation`, `arrhythmia_episode`, `dehydration_heat`, `post_discharge_decline`, `missed_medication`, `off_wrist_silence`: Detected across both seeds (`1.0h` to `21.0h` after onset).
- **`fall_event` (Known Gap / 2 False Negatives):** Observed `stable` (peak `17.7` / `18.5`) while expected `urgent`. **Root cause:** `detectors.py` scores physiological HR/HRV/SpO2/RR/Temp/Steps rollups and contains no IMU fall-impact/post-fall immobility detector. *(Note: `apps/web/src/lib/engine/benchmark-fallback.ts` contains a separate TypeScript simulation fallback used on Vercel `/eval` when `ENGINE_URL` is unset.)*

---

## 4. Synthetic First-Detection & Recovery Lifecycle Evidence

Verified in `apps/web/tests/unit/ps2-verification.test.ts` using `evaluateLocalDeterministicEngine` (`isSynthetic: true`):
1. **Days 0–14 (`Normal`):** `stage = "calibrated"`, `validDays = 15`, `level = "stable"`, `deteriorationIndex < 30`.
2. **Days 15–17 (`Gradual Drift -> First Detection`):** Progressive RHR elevation, SpO2 dip, step reduction, and shortened sleep trigger `level` in `watch | warning | urgent`, `deteriorationIndex >= 30`, `l2Score > 25`, and localized `changePoints.length >= 1`.
3. **Days 19–21 (`Recovery Toward Baseline`):** Returning readings back to personal median drops assessment back to `level = "stable"` with `deteriorationIndex < earlyDrift.deteriorationIndex`.
4. **DB Persistence & Dashboard Timeline:** In `loadPatientDashboard` (`apps/web/src/lib/dashboard/queries.ts`), persisted `risk_assessments`, `detector_decision_logs`, and `alerts` reconstruct `<DetectionTimelineCard />` (`phase: baseline_only -> first_detection -> confirmed_alert -> recovered`) rendered on `/clinician`, `/caregiver`, and `/signals`.
