# Clinical & Physiological Domain Research — SENTINEL

> **Phase 0 Deliverable (Step 2)** · Grounded in published clinical literature and wearable physiological monitoring studies as of November 2026.  
> **Safety Boundary:** SENTINEL is a *screening and early-awareness* system ("changes from your personal normal"), never an autonomous diagnostic or treatment device.

---

## 1. Physiological Deterioration Signatures in Wearable Signals

Chronic disease decompensation and acute systemic illness produce measurable autonomic, cardiorespiratory, thermal, and behavioral shifts **hours to days before overt clinical presentation**. Consumer and clinical wrist/ring sensors capture surrogate signals that behave differently across syndromes:

| Condition / Syndrome | Primary Wearable Signal Trajectory (Pre-Clinical / Early) | Secondary & Behavioral Shifts | Lead-Time Evidence & Clinical Notes |
|---|---|---|---|
| **Heart Failure (HF) Decompensation** | **Resting HR (RHR) ↑** (sympathetic compensation); **HRV (RMSSD/SDNN) ↓** (vagal withdrawal); **Respiratory Rate (RR) ↑** especially nocturnal (pulmonary congestion / Cheyne-Stokes patterns) | **Steps / activity ↓** progressively over 3–14 days; **sleep efficiency ↓**, frequent nocturnal awakenings (orthopnea / paroxysmal nocturnal dyspnea); SpO₂ dips during fluid overload | Multi-sensor HF telemonitoring (e.g., LINK-HF, MultiSENSE) shows autonomic/activity/respiratory shifts precede unplanned HF hospitalization by days to ~2 weeks. Weight gain (+2 kg in 2–3 days) from manual/smart-scale entry is a crucial adjunct. |
| **COPD Acute Exacerbation (AECOPD)** | **Respiratory Rate ↑** (earliest, most sensitive respiratory cue); **SpO₂ ↓** from patient's own baseline (hypercapnic patients may sit at 88–92% normally!) | **RHR ↑**; **daily step count & walking cadence ↓** due to exertional dyspnea; **sleep fragmentation ↑** | Crucial requirement: COPD patients on **NEWS2 Scale 2** have hypercapnic target SpO₂ of **88–92%**, so fixed 95% cutoffs cause chronic false alarms. Personal baseline + Scale 2 flag prevents alarm fatigue. |
| **Infection & Sepsis** | **Skin Temperature Deviation ↑** (+0.5 °C to +1.5 °C above nocturnal personal norm); **RHR ↑** (+5 to +15 bpm above baseline); **HRV (RMSSD) ↓** markedly; **RR ↑** | **Sleep duration ↑** (sickness behavior) OR fragmented febrile sleep; **steps ↓** sharply; self-reported chills/fatigue in voice check-in | Mishra et al. (*Nature Biomedical Engineering*, 2020) and Quer et al. (*Nature Medicine*, 2020) showed RHR, sleep, and activity shifts detect viral/systemic infection **2–4 days pre-symptomatically** in 63–80% of cases. TemPredict (Smarr et al., 2020) confirmed continuous distal skin temperature + RHR/RR signals onset of fever. |
| **Arrhythmia (AFib / Tachy- / Bradyarrhythmia)** | Sudden **HR spikes >110–130 bpm at rest** or **bradycardia <40–45 bpm**; elevated irregular beat-to-beat intervals (sudden paradoxical rise in RMSSD/pNN50 due to erratic PPG peaks rather than healthy RSA!) | **HRV artifact/irregularity jump**; irregular rhythm notifications / AFib burden metric (when provided by Apple/Fitbit/Samsung/Garmin); subjective palpitations/dizziness in check-in | Wrist PPG detects persistent/paroxysmal AFib with ~84–95% sensitivity and ~93% specificity in resting windows, **but** motion degrades beat detection; high RMSSD spikes paired with low signal quality must NOT be mistaken for "recovery". |
| **Diabetes & Glycemic Dysregulation** | **Nocturnal RHR ↑ + HRV ↓** during autonomic counter-regulatory adrenergic surge (hypoglycemia) or sustained hyperglycemic stress; **CGM blood glucose** (<70 mg/dL or >250 mg/dL) if connected | **Sweat/skin temp dip or spike**, sleep disruption, missed meals/medication adherence gaps | Without a CGM stream, wrist PPG alone **cannot** measure blood glucose; SENTINEL must label hypoglycemia inference from autonomic surges as low-specificity and prioritize CGM / manual glucometer + symptom check-in when diabetes module is active. |
| **Dehydration & Heat Stress** | **RHR ↑ disproportionate to step count / activity** (cardiovascular drift to maintain cardiac output despite falling plasma volume); **skin temperature ↑**; **HRV ↓** | Coupled with **ambient heat/humidity (heat index)** via Open-Meteo; reduced activity, reported dizziness/dark urine/thirst during voice check-in | Directly relevant to **coastal Karnataka / Mangalore** elderly populations during high heat-index months (Mar–May, post-monsoon humidity). Older adults have blunted thirst reflexes and impaired sweating; environmental confounder integration avoids misclassifying heat strain as cardiac failure *while* generating safe hydration nudges. |
| **Post-Discharge Decline** | **Multi-day downward step trajectory**; **persistent elevated RHR** & **suppressed HRV** failing to normalize toward pre-admission/discharge baseline; **worsening sleep efficiency** | **Missed medication schedules**, worsening voice check-in symptom score, **device non-wear ("silent for N hours")** indicating potential acute incapacity or abandonment | Hospital-to-home transitions (7–30 days post-discharge) carry peak readmission risk. Systematic reviews show readmission reduction depends on **paired care-circle workflows** rather than passive raw telemetry alone. |

---

## 2. Signal Reliability & Wrist-Wearable Weaknesses

Wearable telemetry is noisy, non-stationary, and unequally accurate across populations. SENTINEL's Data Quality Pipeline (Layer C) and Confidence Score explicitly discount unreliable windows:

### Reliability Tiering by Metric
1. **High Reliability (Nocturnal / Resting Windows):**
   - **Resting Heart Rate (RHR):** Most robust long-term autonomic drift metric when computed strictly during confirmed sleep or ≥20-min sedentary zero-step windows.
   - **Step Count & Sedentary Duration:** Reliable macro-indicator of functional decline/frailty, though wrist accelerometers undercount slow shuffling gaits with walkers/canes in frail elders (bias toward lower steps).
   - **Sleep Duration & Timing:** Reliable for sleep/wake onset and multi-night routine drift; sleep-stage labels (REM/Deep) from consumer PPG have lower agreement (~60–75% vs PSG) and should be treated as secondary.
2. **Moderate / Context-Sensitive Reliability:**
   - **HRV (RMSSD / SDNN):** Highly sensitive to autonomic stress, **but** severely corrupted by wrist motion, loose straps, premature atrial/ventricular contractions (PACs/PVCs common in >70 age groups), and short sampling windows. Best extracted from nocturnal/resting intervals.
   - **Respiratory Rate (RR):** Derived via Respiratory Sinus Arrhythmia (RSA) or PPG amplitude/baseline modulation; accurate within ~1–2 breaths/min during sleep, unusable during moderate/vigorous motion.
   - **Skin Temperature Deviation:** Wrist skin temperature tracks circadian phase and peripheral vasoconstriction/vasodilation rather than core oral temperature directly. Ambient room temperature, blanket coverage, and charging cycles shift absolute values—therefore **overnight relative deviation from personal nocturnal median** is the valid signal.
3. **Low / Conditional Reliability:**
   - **Wrist PPG SpO₂:** Highly susceptible to **motion artifacts**, **cold extremities / low peripheral perfusion** (common in elderly heart failure / PAD), **loose strap ambient light leak**, and **skin-tone bias**.
   - **Cuffless Blood Pressure:** Consumer watch estimates require frequent cuff calibration and lack sufficient acute clinical accuracy for standalone emergency triggering.

### Known Hardware, Physiological & Equity Weaknesses
- **Skin-Tone Effects on Optical PPG:** Melanin strongly absorbs shorter-wavelength green LED light (typically used for PPG HR) and alters optical scattering for red/IR pulse oximetry. Clinical studies (Sjoding et al., *NEJM* 2020; FDA Safety Communication 2021–2024; Bent et al., *npj Digital Medicine* 2020) demonstrate higher occult hypoxemia rates (overestimated SpO₂) and higher HR error during motion in individuals with darker skin tones (Fitzpatrick IV–VI — directly covering most Indian elderly patients in Karnataka). **Mitigation:** Never rely on single-spot wrist SpO₂ drops without persistence + multi-signal corroboration; display explicit signal confidence and caveat warnings; treat relative *drop from personal baseline* rather than only absolute cutoffs as the primary watch cue.
- **Motion Artifacts & Geriatric Tremors:** Parkinsonian or essential tremors, poor skin-sensor contact on frail/wrinkled skin, and walker vibration corrupt PPG waveforms. **Mitigation:** Require IMU/step-gated resting windows (`steps == 0` and activity == `rest`/`sleep`) for RHR, HRV, RR, and SpO₂ baseline updates and L2/L3 scoring; flag high-motion windows with `motion_artifact`.
- **Off-Wrist & Charging Gaps:** Elderly users frequently remove watches for bathing, charging, or comfort, or forget to put them back on. A silent device for >12–24 hours is ambiguous: could be forgotten charger OR an acute fall/hospitalization. **Mitigation:** Dedicated non-physiological **"Device silent for N hours"** safety escalation signal, distinct from clinical anomaly alerts.

---

## 3. Published Early-Warning Scores: NEWS2 & Wearable Subset

The **National Early Warning Score 2 (NEWS2)** (Royal College of Physicians, 2017) is the clinical standard for detecting acute deterioration across six parameters + supplemental oxygen:

| Parameter | NEWS2 Score 3 | 2 | 1 | 0 | 1 | 2 | 3 | Wearable Support in SENTINEL |
|---|---|---|---|---|---|---|---|---|
| **Respiration Rate** (`/min`) | ≤ 8 | — | 9–11 | 12–20 | — | 21–24 | ≥ 25 | **Supported (Nocturnal / Resting)** via PPG/RSA derived RR |
| **SpO₂ Scale 1** (%) | ≤ 91 | 92–93 | 94–95 | ≥ 96 | — | — | — | **Conditional** via wearable SpO₂ (requires persistence + quality gate) |
| **SpO₂ Scale 2 (COPD / Hypercapnic)** (%) | ≤ 83 | 84–85 | 86–87 | 88–92 (air) | 93–94 (O₂) | 95–96 (O₂) | ≥ 97 (O₂) | **Conditional** when COPD Scale 2 is configured by clinician |
| **Air or Oxygen?** | — | Oxygen (+2) | — | Air (0) | — | — | — | **Manual / Profile Config** (caregiver/clinician setting) |
| **Systolic BP** (`mmHg`) | ≤ 90 | 91–100 | 101–110 | 111–219 | — | — | ≥ 220 | **Manual / Paired Cuff Only** (not inferred from wrist PPG) |
| **Pulse Rate** (`/min`) | ≤ 40 | — | 41–50 | 51–90 | 91–110 | 111–130 | ≥ 131 | **Supported (Continuous / Resting)** via PPG HR / RHR |
| **Consciousness (ACVPU)** | — | — | — | Alert (0) | — | — | New Confusion / V / P / U (+3) | **Active Check-In Only** (elder voice/tap response; missed check-in flags review, cannot auto-score U) |
| **Temperature** (°C) | ≤ 35.0 | — | 35.1–36.0 | 36.1–38.0 | 38.1–39.0 | ≥ 39.1 | — | **Partial Proxy** (calibrated oral/tympanic manual input exact; wrist skin temp delta mapped conservatively as thermal trend, never falsely equated to core °C without offset calibration) |

### Architectural Implication for SENTINEL
- **Wearables can natively support 3 to 4 of 6 NEWS2 physiological axes** (Pulse Rate, Respiratory Rate, SpO₂ with quality caveats, plus relative Temperature trend), while **Systolic BP and ACVPU cannot be passively inferred**.
- Therefore, SENTINEL **never** displays a deceptive "NEWS2 = 5" when BP and ACVPU are missing. Instead, it computes:
  1. **SENTINEL Deterioration Index (0–100)** from L1 safety rules + L2 personal univariate change/EWMA/CUSUM + L3 multivariate Mahalanobis/Half-Space Trees/Isolation Forest.
  2. **Partial NEWS2-Aligned Screening Breakdown** clearly showing observed wearable parameters vs `Missing (Manual BP / Check-in required)` so clinicians see familiar clinical anchors honestly.

---

## 4. Alert Fatigue Evidence & Design Countermeasures

Empirical alarm research shows why naive threshold systems fail in real care:
- **Drew et al. (2014, *PLOS ONE*):** Over 31 days across 5 adult ICUs (461 patients), telemetry recorded **381,560 audible alarms** (**187 alarms/bed/day**), and **88.8% of annotated arrhythmia alarms were false positives** caused by motion artifacts, lead issues, and non-actionable transient excursions.
- **Cvach (2012, *Biomedical Instrumentation & Technology*):** Synthesized clinical alarm studies showing **80% to 99% of clinical monitor alarms are false or clinically insignificant**, driving staff desensitization, delayed response, and unsafe alarm silencing.
- **Regulatory Recognition:** The Joint Commission **NPSG.06.01.01** (Clinical Alarm Safety) and ECRI Institute's Top 10 Health Technology Hazards explicitly mandate personalized alarm parameters, delay/persistence filtering, and tiered escalation rather than factory population limits.

### How SENTINEL Prevents Alert Fatigue
1. **Personal Baselines over Static Population Cutoffs:** Elderly patients often have healthy baseline RHR of 52 bpm (beta-blockers) or 84 bpm, or baseline COPD SpO₂ of 90%. Personal median + MAD z-scores absorb individual physiology.
2. **Persistence (`N of M` windows) & Hysteresis:** Transient 2-minute artifacts never page a caregiver; alerts require sustained elevation across consecutive low-motion windows (except extreme L1 physiological emergencies verified across multiple samples).
3. **Confounder Suppression:** Suppress HR alerts during logged/detected exercise (`steps/min > threshold`), recent waking inertia, and account for ambient heat index (Open-Meteo) + user-logged illness/travel/medication-change exclusions.
4. **Cooldowns, Daily Alert Budget & Deduplication:** Maximum non-urgent alert budget per patient/day, per-rule cooldown windows, and escalation-state grouping so caregivers see *one updating incident thread* rather than 20 duplicate pings.
5. **Closed-Loop Feedback:** Caregiver/clinician "False Alarm" / "Helpful" / "Confirmed Illness" feedback adjusts sensitivity strictly within safety-bounded rails (L1 absolute rules can never be silenced below clinical minimums).

---

## 5. References & Data Sources

1. Royal College of Physicians (2017). *National Early Warning Score (NEWS) 2: Standardising the assessment of acute-illness severity in the NHS*.
2. Mishra, T., Wang, M., Metwally, A. A., et al. (2020). *Pre-symptomatic detection of COVID-19 from smartwatch data*. Nature Biomedical Engineering, 4(12), 1208–1220.
3. Quer, G., Radin, J. M., Gadaleta, M., et al. (2020). *Wearable sensor data and self-reported symptoms for COVID-19 detection*. Nature Medicine, 27, 73–77.
4. Smarr, B. L., Aschbacher, K., Fisher, S. M., et al. (2020). *Feasibility of continuous fever monitoring using wearable devices*. Scientific Reports, 10, 21640 (TemPredict).
5. Stehlik, J., Schmalfuss, C., Bozkurt, B., et al. (2020). *Continuous Wearable Monitoring Analytics Predict Heart Failure Hospitalization (LINK-HF)*. Circulation: Heart Failure, 13(3).
6. Sjoding, M. W., Dickson, R. P., Iwashyna, T. J., Gay, S. E., & Valley, T. S. (2020). *Racial Bias in Pulse Oximetry Measurement*. New England Journal of Medicine, 383, 2477–2478.
7. Bent, B., Goldstein, B. A., Kibbe, W. A., & Dunn, J. P. (2020). *Investigating sources of inaccuracy in wearable optical heart rate sensors*. npj Digital Medicine, 3, 18.
8. Drew, B. J., Harris, P., Zègre-Hemsey, J. K., et al. (2014). *Insights into the Problem of Alarm Fatigue with Physiologic Monitor Devices: A Comprehensive Observational Study of Consecutive Intensive Care Unit Patients*. PLOS ONE, 9(10), e110274.
9. Cvach, M. (2012). *Monitor alarm fatigue: an integrative review*. Biomedical Instrumentation & Technology, 46(4), 268–277.
10. Government of India (2023). *The Digital Personal Data Protection Act, 2023* (Sections 6, 7(f) medical emergency, 8 security safeguards, 11–13 rights of consent withdrawal & erasure).
11. Google Fitbit Developer Docs / Terra API Migration Notices (2026). *Legacy Fitbit Web API shutdown (support ended Sept 30, 2026; endpoints turned off Nov 2, 2026 -> 410 Gone); successor: Google Health API*.
