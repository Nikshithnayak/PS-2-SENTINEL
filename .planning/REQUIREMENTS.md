# Requirements Specification — SENTINEL

> **Phase 0 Deliverable (Step 5)** · All requirements carry unique IDs, MoSCoW priority (`P0` Must, `P1` Should, `P2` Could), and testable acceptance criteria.

---

## A. Accounts, Roles, Consent & Security (DPDP Act 2023)

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| `REQ-AUTH-01` | **P0** | Multi-role authentication & RBAC (`patient`, `caregiver`, `clinician`, `org_admin`) | Sign-up/login creates Better Auth session; unauthorized role access to another patient's routes/APIs returns HTTP 403 enforced by app RBAC and Postgres RLS. |
| `REQ-AUTH-02` | **P0** | Care-circle invitations & granular per-person consent ledger | Patient can invite caregiver/clinician via scoped invite token, grant/revoke specific scopes (`vitals_read`, `alerts_receive`, `clinician_export`), and withdrawal blocks subsequent reads immediately. |
| `REQ-SEC-01` | **P0** | PHI field-level encryption & zero-PII external calls | Sensitive patient identifiers encrypted with AEAD (`AES-256-GCM`) at rest; outbound calls to Open-Meteo, RxNorm, openFDA, Nominatim, and optional LLM contain zero PII/identifiers. |
| `REQ-SEC-02` | **P0** | Append-only hash-chained audit log | Every consent change, login, data export, alert state change, and deletion writes a row whose SHA-256 `entry_hash` links `prev_hash`; tampering fails chain verification test. |
| `REQ-SEC-03` | **P0** | DPDP Act self-service data export & erasure | Patient/admin can export all stored JSON/FHIR data and trigger account/PHI erasure (preserving anonymized safety/audit hashes where legally required). |
| `REQ-SEC-04` | **P1** | De-identified partner/researcher cohort view | `org_admin` cohort endpoints return k-anonymous / pseudonymized aggregates with zero names, emails, phones, or exact GPS coordinates. |

---

## B. Data Ingestion & Provenance

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| `REQ-ING-01` | **P0** | Provider-adapter interface & authenticated Open Ingestion API | `POST /api/v1/ingest` authenticates via hashed per-patient/device API key, validates canonical Zod batch payloads, and enforces idempotency (`(patient_id, metric_type, recorded_at, source_hash)`). |
| `REQ-ING-02` | **P0** | Streaming Apple Health `export.xml` importer | Streams XML without buffering entire file in memory, converts HealthKit `%` (0–1 -> 0–100) and imperial/metric units (`degF->degC`, `lb->kg`), reports parsed/skipped stats, and creates persisted `vital_samples`. |
| `REQ-ING-03` | **P0** | Google / Fitbit Takeout & generic CSV column-mapper importer | Parses Takeout JSON/CSV files and arbitrary CSV exports via interactive column/unit mapping UI, recording provenance (`source`, `device_model`, `ingest_batch_id`). |
| `REQ-ING-04` | **P0** | Live provider adapter (`Open Wearables` + `Google Health API`) | Clean `ProviderAdapter` implementations for `OpenWearablesAdapter` (pull/webhook) and `GoogleHealthAdapter` (v4 dataTypes); functions live when credentials exist and fails gracefully with setup doc link otherwise. |
| `REQ-ING-05` | **P0** | Seeded Synthetic Data Mode | Generator creates multi-day physiologically plausible series + labeled scenarios; every synthetic sample and UI view carries `is_synthetic = true` and renders a prominent `SYNTHETIC` badge. |

---

## C. Data Quality & Context Pipeline

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| `REQ-QUAL-01` | **P0** | Time normalization, deduplication & physical unit bounds | Normalizes timestamps to UTC while keeping patient timezone for circadian indexing; rejects/flags impossible values (e.g. HR <20 or >250, SpO₂ >100%) and preserves provenance. |
| `REQ-QUAL-02` | **P0** | Wear-time, motion-artifact & gap flags | Computes hourly wear-time fraction, marks elevated-step/exercise intervals as `motion_artifact` for optical PPG metrics, and computes per-window `data_confidence` (0–1). |
| `REQ-QUAL-03` | **P0** | "Device silent for N hours" non-physiological safety signal | Emits explicit `device_silent` alert if expected telemetry stops beyond configurable patient threshold (default 12h), separate from clinical anomalies. |
| `REQ-QUAL-04` | **P1** | Environmental confounder context (Open-Meteo weather/heat/AQI) | Fetches district/city-level temperature, apparent heat index, humidity, and PM2.5; attaches confounder tags and issues hydration/heat guidance during extreme heat stress. |

---

## D & E. Personal Baseline & Deterministic Anomaly Detection (`services/engine`)

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| `REQ-ENG-01` | **P0** | Context-aware personal baseline with 14-day shrinkage warm-up | Learns per-person, per-metric, per-context (`sleep`, `rest`, `light`, `exercise`), circadian & weekday median + MAD; shrinks from age/sex/condition priors on days 1–13 (`Learning, day X of 14`) -> `Calibrated` on day >=14 with >=10 valid days. |
| `REQ-ENG-02` | **P0** | Baseline contamination protection | Windows flagged anomalous or user/clinician marked as `excluded` (illness, travel, medication change) are strictly excluded from baseline parameter updates (verified by Hypothesis property test). |
| `REQ-ENG-03` | **P0** | Three-layer deterministic detection (L1 + L2 + L3) | Computes L1 cited safety rules, L2 univariate robust z-score + EWMA + CUSUM/Page-Hinkley + `ruptures` change-points, and L3 multivariate `MinCovDet` Mahalanobis + `river.HalfSpaceTrees` / `IsolationForest`. Autoencoder stays behind disabled feature flag unless beating L3. |
| `REQ-ENG-04` | **P0** | Fusion -> Deterioration Index (0–100), levels & explainability | Outputs deterministic `0..100` score, level (`stable`, `watch`, `warning`, `urgent`), per-signal contributions, 72-hour trend, confidence score, and full `DetectorDecisionLog`. |
| `REQ-ENG-05` | **P0** | Confounder control & reproducibility | Exercise intervals do not trigger resting HR alerts; runs are seeded and deterministic; golden scenarios pass reliably in CI. |
| `REQ-ENG-06` | **P1** | Condition modules (`heart_failure`, `copd`, `hypertension`, `diabetes`, `frailty`) | Selecting a condition module adjusts watched metric weights, e.g., COPD switches SpO₂ anchor to NEWS2 Scale 2 (88–92%) and prioritizes respiratory rate. |

---

## F. Alerting, Anti-Fatigue & Escalation

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| `REQ-ALT-01` | **P0** | Anti-fatigue policy engine | Applies `N of M` persistence windows, hysteresis exit bands, rule cooldowns, per-patient daily alert budget (default 3 non-urgent/day), quiet hours (`Urgent` bypasses), and incident deduplication. |
| `REQ-ALT-02` | **P0** | Timed escalation ladder & bounded feedback tuning | Escalates Patient Nudge -> Primary Caregiver -> Secondary Caregiver -> Clinician -> Emergency Prompt (`112`/`108` + nearest hospital); supports Acknowledge, Snooze, and False Alarm feedback that tunes sensitivity within audited safety bounds. |
| `REQ-ALT-03` | **P0** | Transactional outbox + multi-channel delivery | Persists outbox jobs in Postgres with idempotency keys, exponential retry, delivery receipts; supports In-App SSE, Web Push (VAPID), Email, Telegram, and `ntfy` (SMS/WhatsApp flag-gated adapter). |
| `REQ-ALT-04` | **P1** | Caregiver two-way email reply (`agentic-inbox` pattern) & Telegram bot | Replying `OK`, `CALL ME`, or `SNOOZE` to alert email (via `workers/inbox` or local webhook) or tapping Telegram inline button updates incident state & audit log immediately. |

---

## G. Dashboards, Voice Companion, Experience & Reporting

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| `REQ-UI-01` | **P0** | Patient Today (Elder Mode) | >=18px text, >=48px touch targets, 1 calm plain status sentence, 3 key vitals, 1-tap `I am OK` / `I feel unwell` / `Call my caregiver`, read-aloud button, language switch (`en`/`kn`/`hi`), subtle reduced-motion-safe status aura. |
| `REQ-UI-02` | **P0** | Caregiver Console & Alert Inbox | Ranked circle list by Deterioration Index, explainable alert inbox (what changed, since when, confidence, next step), acknowledge/snooze/notes, timeline, quick call/message, shareable status link/summary. |
| `REQ-UI-03` | **P0** | Clinician View & Signal Explorer | Zoomable Apache ECharts multi-signal timelines with baseline ±1/2 MAD bands, change-points, alert & medication overlays, window comparison, partial NEWS2 table, Signal Explorer raw trace inspector. |
| `REQ-UI-04` | **P0** | Landing Page, Signature Visuals, Accessibility & Performance | `ShaderGradient` hero + 1 R3F pulse waveform on landing only; restrained `liquid-glass` floating chrome; LCP < 2.5s simulated 4G, Lighthouse Perf >= 90, Accessibility = 100, axe 0 serious violations, light/dark themes, all 5 component states. |
| `REQ-UI-05` | **P1** | Multilingual i18n (`en`, `kn`, `hi`) & PWA Offline Shell | Full `next-intl` translations across Patient Today, alerts, and onboarding in English, Kannada (`ಕನ್ನಡ`), and Hindi (`हिन्दी`), installable PWA manifest & service worker offline banner. |
| `REQ-COMP-01` | **P1** | Elder Voice Check-In & Medication Adherence | Hands-free / tap-to-speak symptom check-in (`en`/`kn`/`hi`) with interruption/read-aloud + medication schedule & adherence dots overlaid on clinician charts. |
| `REQ-EVAL-01` | **P1** | In-App Evaluation Lab, Model Card, Clinician PDF & FHIR R4 Export | Live benchmark runner showing measured sensitivity, PPV, lead time, false alerts/patient-week, baseline convergence, L1/L2/L3 ablations vs fixed threshold; downloadable clinical PDF & valid `@medplum/fhirtypes` FHIR R4 Bundle (`Patient`, `Observation`, `Flag`). |
| `REQ-P2-01` | **P2** | Fall detection events, sleep-routine drift, weekly digest & Open Wearables SDK hook | Ingest accelerometer fall flags when supplied, track bedtime drift, generate weekly caregiver digest preview, document native mobile SDK bridge. |
