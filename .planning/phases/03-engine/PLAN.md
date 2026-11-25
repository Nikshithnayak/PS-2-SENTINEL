# Phase 3 Plan — Personal Baseline & 3-Layer Detection Engine

## Objectives
1. Implement deterministic, auditable personal baseline learning with 14-day empirical Bayes shrinkage, robust median/`1.4826 * MAD` scaling, slow EWMA adaptation, circadian/weekday adjustments, and strict contamination quarantine (`excluded_periods` + outlier masking).
2. Implement 3-layer physiological anomaly detection in `services/engine/engine/`:
   - **L1:** Clinical critical safety limits & partial NEWS2 (Scale 1 + COPD Scale 2).
   - **L2:** Personal univariate robust z-score, EWMA drift, CUSUM/Page-Hinkley accumulator, and `ruptures.Pelt` change-point detection.
   - **L3:** Multivariate `MinCovDet` Mahalanobis distance, streaming `river.anomaly.HalfSpaceTrees`, and `IsolationForest` (autoencoder kept off behind `ENABLE_AUTOENCODER_L3`).
   - **Fusion & Confounder Control:** Calibrated `0..100` Deterioration Index, level mapping (`stable`, `watch`, `warning`, `urgent`), exercise & coastal heat-wave attenuation, data-confidence discounting, plain-English non-diagnostic explanations, and full `DetectorDecisionLog`.
3. Implement benchmark/ablation harness (`eval_harness.py` + `datasets/loaders.py`) comparing `fixed_only` vs `L1+L2` vs `L1+L2+L3` across seeded synthetic scenarios and PMData/LifeSnaps/WESAD/MMASH schemas.
4. Wire FastAPI endpoints (`/v1/baseline/fit`, `/v1/score/evaluate`, `/v1/eval/benchmark`), Next.js APIs (`/api/v1/engine/evaluate`, `/api/v1/exclusions`), auto-boot Python FastAPI inside `boot-local.ts`, and verify with pytest + Hypothesis + Vitest + Playwright/axe.
