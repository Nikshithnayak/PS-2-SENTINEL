# Model Card — Sachet · SENTINEL (`sentinel-det-v1.0.0`)

## Model Summary
Sachet · SENTINEL uses an auditable, strictly deterministic 3-layer physiological deterioration detector over wearable telemetry paired with contextual weather and medication adherence metadata. LLMs never gate alerts and may only optionally verbalize already-computed structured findings.

## Intended Use & Scope
- **Primary Task:** Detect early physiological deterioration patterns (infection/sepsis prodrome, heart failure decompensation, COPD exacerbation, arrhythmia, dehydration/heat strain, post-discharge functional decline) relative to each individual's calibrated personal baseline.
- **Not a Medical Device:** Outputs use non-diagnostic awareness copy (*"changes from your personal normal"*) and direct severe symptoms to configured emergency numbers (India default: `112` Emergency, `108` Ambulance).

## Method
1. **Personal Baseline Engine (`services/engine/engine/baseline.py`):**
   - Context-separated (`sleep`, `rest`, `light_activity`, `exercise`) weighted median and `1.4826 * MAD` scale, circadian block offsets (`night`, `morning`, `afternoon`, `evening`), weekday/weekend terms, and empirical Bayes shrinkage toward age/condition priors during Days 1–14.
   - Strict **Contamination Quarantine**: skips `excluded_periods` (illness, travel, hospital stays), withholds tail acute windows once calibrated history exists, and masks `> 3.5 sigma` transient outliers during fitting.
2. **Three-Layer Detection (`services/engine/engine/detectors.py`):**
   - **L1 (Safety Bounds):** NEWS2-aligned critical bounds with COPD Scale 2 support (`88–92%`) and exercise context guarding.
   - **L2 (Personal Temporal):** Directional z-scores, EWMA (`lambda=0.25`), one-sided Page-Hinkley/CUSUM, and `ruptures.Pelt` RBF change-point detection.
   - **L3 (Multivariate Coherence):** `MinCovDet` / `LedoitWolf` Mahalanobis distance, streaming `river.anomaly.HalfSpaceTrees`, and `IsolationForest`. Autoencoder remains behind disabled `ENABLE_AUTOENCODER_L3=false`.

## Limitations & Equity Risks
- **PPG Melanin / Skin-Tone & Perfusion Effects:** Wrist optical PPG exhibits higher error rates on darker skin tones and cold/low-perfusion extremities; finger pulse oximetry and clinical evaluation are always advised for suspicious readings.
- **Motion Artifacts:** Optical SpO2 and HR readings concurrent with high step bursts (`>= 35 steps/5m`) are explicitly flagged `motion_artifact` and attenuated.
- **Partial NEWS2:** Passive wearables cannot score ACVPU consciousness, supplemental O2 use, or cuff BP without user/clinical entry; missing inputs remain marked `unavailable_from_wearable`.

## Quantitative Evaluation
Live walk-forward causal benchmarks across 11 seeded physiological trajectories (without future lookahead) compare `fixed_clinical_only`, `L1_L2_personal`, and `L1_L2_L3_full` in `/eval` (`POST /api/v1/engine/benchmark`).
