# gstack Pressure-Test Synthesis — SENTINEL

> **Phase 0 Step 4 Deliverable** · Executed using `.agents/workflows/office-hours.md`, `ceo-review.md`, and `eng-review.md` before locking `PROJECT.md`, `REQUIREMENTS.md`, and `ROADMAP.md`.

---

## 1. Office Hours Pass (Forcing Questions & Premise Challenge)

### Answers to the Six Forcing Questions
1. **Demand Reality:** Families caring remotely for elderly chronic-care parents already spend anxious minutes daily calling to ask *"Did you sleep okay? Did you take your morning Furosemide? Are you feeling breathless?"* Clinicians discharging heart-failure or COPD patients suffer ~20% 30-day readmission risk with zero home visibility between visits. A passive watch baseline + explainable caregiver alert replaces guesswork with verifiable physiological early warning.
2. **Status Quo:** WhatsApp photos of blood-pressure cuffs, forgotten paper diaries, or noisy smartwatch apps yelling "High Heart Rate: 112 bpm!" while the patient walks up stairs.
3. **Desperate Specificity:** **Ramesh Pai (72)**, post-heart-failure + mild hypertension living in Bejai, Mangaluru with basic Android phone and Kannada preference; **Kavitha Pai (41)**, his daughter working in Bengaluru; **Dr. Arvind Shetty**, outpatient cardiologist/geriatrician reviewing 30 patients/morning at K.S. Hegde / Nitte clinic.
4. **Narrowest Wedge:** Reliable ingestion -> 14-day personal baseline with contamination protection -> deterministic multi-layer deterioration score -> fatigue-proof caregiver alert ladder -> dead-simple Elder Today screen.
5. **Observation & Friction:** If Elder Today shows 6 tiny ECharts sparklines or forces login hoops, Ramesh stops opening it. If Kavitha gets 4 alerts during Ramesh's morning walk, she mutes notifications. Thus: **Elder Today shows ONE calm status sentence, 3 big vitals, 3 giant buttons (`I am OK`, `I feel unwell`, `Call my caregiver`), Kannada/Hindi/English + voice read-aloud**; motion confounding suppresses exercise alerts automatically.
6. **Future-Fit (3 Years):** Fitbit Web API died Nov 2, 2026; wearables keep shifting to Google Health API, Health Connect, HealthKit, and open schemas like Open Wearables. Owning our canonical `ProviderAdapter` + deterministic statistical engine guarantees longevity across any sensor vendor.

### Premise Challenge
- **Premise 1 Challenged:** *"Should we train a deep autoencoder on day 1 as the core anomaly detector?"* -> **REJECTED.** Autoencoders lack transparent feature attribution on small N=14-day baselines and fail auditability. Deterministic L1 + L2 (robust z-score, EWMA, CUSUM, `ruptures`) + L3 (Mahalanobis, `river.HalfSpaceTrees`, `IsolationForest`) is superior; autoencoder is strictly optional behind a feature flag and only enabled if ablation proves it beats L3.
- **Premise 2 Challenged:** *"Should an LLM evaluate vitals and decide whether to page caregivers?"* -> **REJECTED.** Non-deterministic, high latency, leaks PHI, and unacceptable clinical risk. Statistical core decides 100% of scores and alerts; de-identified findings may optionally be phrased for humans.
- **Premise 3 Challenged:** *"Should we implement Live2D animated avatars like Open-LLM-VTuber?"* -> **REJECTED.** Live2D carries proprietary licensing (`LICENSE-Live2D.md`) and distracts elderly users; clean voice/tap check-in UI with clear waveform & audio playback is safer and faster.

### Alternatives Considered
- **Approach A (Minimal Viable):** Simple next.js dashboard + basic Python z-score script. *Rejected:* Fails multi-role RBAC, transactional outbox escalation, Apple XML streaming, consent ledger, and clinical evaluation rigor.
- **Approach B (Recommended — Selected):** Clean modular monorepo (`apps/web` Next.js 16 + `services/engine` FastAPI + `packages/shared` Zod + optional `workers/inbox`) backed by PostgreSQL (partitioned vitals + Drizzle + Better Auth + RLS + outbox + SSE), deterministic 3-layer engine, and Playwright/Hypothesis verification.
- **Approach C (Over-Scoped):** Native iOS/Android Kotlin/Swift mobile apps + Kubernetes + full Medplum FHIR server + custom LLM fine-tuning. *Rejected:* Violates focus, slows iteration, and PWA + adapter architecture + `@medplum/fhirtypes` export delivers complete value cleanly.

---

## 2. CEO Scope Review (Wedge & Explicit Cuts)

- **Posture:** `SELECTIVE EXPANSION` on elder accessibility, clinical explainability, and security/DPDP compliance; `SCOPE REDUCTION` on unnecessary native apps, heavy generative media (`Open-Generative-AI` -> `SKIP`), and redundant chat UIs.
- **Zero Silent Failures Audit:**
  - Malformed / 500MB Apple `export.xml` -> streaming `iterparse` with per-record skip counters + quality summary report (`invalid_unit`, `invalid_date`, `duplicate`).
  - Python engine down / timeout -> Next.js circuit-breaker surfaces explicit degraded status (`"Scoring delayed — last evaluated at HH:MM"`), never fakes `"Stable"`!
  - Outbound Email / Telegram / Push failure -> Postgres `alert_deliveries` transactional outbox retries with exponential backoff and surfaces delivery receipts in Caregiver Alert Inbox.
  - Off-wrist / dead battery -> `device_silent` safety workflow notifies caregiver after configurable window (e.g., 12h/24h) without conflating silence with physiological arrhythmia.
- **Explicit Cuts (`NOT in Scope`):**
  - Clinical diagnosis, automated prescription/dosage changes, or claiming FDA/CDSCO Class C SaMD clearance.
  - Native mobile HealthKit/Health Connect binary apps (kept as P2 via Open Wearables mobile SDK integration).
  - Unvalidated cuffless watch blood-pressure inference.
  - Generative AI images of fake patients (`Open-Generative-AI` skipped).

---

## 3. Engineering Review (Boundaries, Two-Shape Check & Failure Matrix)

### Two-Shape Check for Core Ingestion & Engine Boundary
- **Shape 1 (Rejected):** Next.js directly runs ad-hoc SQL + calls Python script over subprocess per request. *Flaw:* Tight coupling, blocks Node event loop, cannot scale streaming ingestion or async backfill.
- **Shape 2 (Selected):** Next.js owns auth/RBAC, consent checks, upload streaming/idempotent normalization into PostgreSQL, and transactional alert outbox/SSE; `services/engine` FastAPI exposes clean stateless/DB-backed HTTP contracts (`/v1/baseline/fit`, `/v1/score/evaluate`, `/v1/sim/generate`, `/v1/eval/benchmark`) consuming canonical `VitalSample` records and returning typed `RiskAssessment` + `DetectorDecisionLog`.
- **Red-Flag Check:** Canonical metric enums and Zod schemas live once in `packages/shared` and mirror to Python Pydantic contracts via CI contract tests (zero hand-synced silent drift).

### End-to-End Data Flow Diagram
```text
[Wearable / Apple XML / Takeout / CSV / API Push / Synthetic]
                        │
                        ▼
        [1. ProviderAdapter & Idempotent Ingest]
      (Normalize units, UTC timestamps, dedup hash)
                        │
                        ▼
        [2. Data Quality & Context Pipeline]
   (Wear-time, motion-artifact, gap, off-wrist silence,
       Open-Meteo ambient heat/AQI confounder fetch)
                        │
                        ▼
    [Postgres Partitioned vitals + rollups + audit chain]
                        │
                        ▼
        [3. Python Detection Engine (services/engine)]
  ┌──────────────────────────────────────────────────────┐
  │ Personal Baseline (Median/MAD, EWM forgetting,       │
  │   circadian/weekday, prior shrinkage, quarantine)    │
  │ L1 Clinical Rules -> L2 Z/EWMA/CUSUM/Ruptures        │
  │   -> L3 Mahalanobis + HalfSpaceTrees/IsolationForest │
  │ Fusion -> Deterioration Index (0..100) + Attribution │
  └──────────────────────────────────────────────────────┘
                        │
                        ▼
        [4. Alert Policy & Escalation Ladder]
  (N-of-M persistence, hysteresis, cooldown, daily budget,
    quiet hours, deduplication, transactional outbox)
                        │
          ┌─────────────┼─────────────┬──────────────┐
          ▼             ▼             ▼              ▼
      [In-App SSE]  [Web Push]  [Email/Inbox]  [Telegram/ntfy]
                        │
                        ▼
     [Ack / Snooze / False Alarm -> Audit Log & Bounded Tuning]
```

### Failure Mode & Test Verification Matrix

| Component | Failure Mode | Expected Behavior / Rescue | Verification Test |
|---|---|---|---|
| Apple Health XML Import | Huge file / `%` 0–1 fraction / bad date | Streaming parse, `% -> 0..100` normalize, skip bad row with stats | `pytest` + Vitest fixture tests with corrupted & `%` rows |
| Personal Baseline | Contamination during illness episode | Exclude flagged/user-excluded windows from MAD/median updates | Hypothesis property test: injecting 5-day fever never shifts baseline median >5% |
| Alert Engine | Walk/exercise spikes HR to 135 bpm | Step/activity confounder suppresses RHR anomaly alert | Golden scenario test `exercise_confounder` -> 0 false alerts |
| Alert Outbox | SMTP/Telegram down on Urgent alert | Retry with backoff, mark delivery failed, escalate to next channel/step | Vitest outbox retry + channel failover test |
| Consent Withdrawal | Patient revokes caregiver access | Immediate 403 on caregiver reads + hash-chained audit entry | Playwright + API RBAC integration test |
| Frontend Charts/WebGL | Reduced motion / WebGL crash / offline | Static fallback aura, ECharts canvas + accessible data table, PWA offline banner | Playwright + `@axe-core/playwright` (`0 serious` violations) |
