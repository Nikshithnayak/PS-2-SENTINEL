# Sachet · SENTINEL

> **Wearable-Based Early Health Awareness, Deterioration Detection & Indian OPD Ambient Clinical Scribe**  
> Hackathon Brief **S2 · Nitte Pharma Innovation Centre** · Live Production App: [`ps-2-sentinel.vercel.app`](https://ps-2-sentinel.vercel.app)

**SENTINEL** learns each older adult's personal physiological normal over a 14-day shrinkage-calibrated baseline, detects multi-signal health deterioration early via a deterministic 3-layer statistical engine (`L1` safety bounds + `L2` personal temporal/change-point + `L3` multivariate covariance/streaming trees), routes anti-fatigue alerts across caregivers and clinicians, provides an offline-capable **Wispr** multilingual voice check-in & **Ambient OPD Clinical Scribe** (code-mixed English + ಕನ್ನಡ + हिन्दी), and enforces DPDP Act 2023 privacy with PostgreSQL `FORCE ROW LEVEL SECURITY` and hash-chained audit logs.

> **Clinical Safety Notice:** SENTINEL is an early-awareness screening and clinician workflow tool — **NOT an autonomous diagnostic medical device**. Patient wording frames *"changes from your personal normal"*, clinician OPD drafts (SOAP notes, Rx suggestions, patient summaries) require physician review and explicit **Approve & Sign**, and urgent screens surface regional emergency contacts (`112` Emergency, `108` Ambulance).

---

## Core Capabilities

### 1. Direct Wearable & Health Data Sync (`/ingest`)
- **Google Fit & Google Health OAuth 2.0:** One-click OAuth connector (`/api/v1/connectors/google/connect`) sharing a verified callback with Better Auth and storing AES-256-GCM encrypted refresh tokens.
- **Android Health Connect Direct Bridge:** Authenticated webhook URL + scannable QR code (`/api/v1/ingest/watch`) decoding Health Connect payloads (`resting_heart_rate`, `hrv_rmssd`, `spo2`, `respiratory_rate`, `steps`, `sleep_duration`, `skin_temp`).
- **Live Web Bluetooth (`0x180D` / `0x2A37`):** Pairs directly in Chromium browsers with BLE HR monitors and computes RR-interval RMSSD HRV live.
- **Universal Imports & Context:** Streams Apple Health `export.xml`, parses Google Fit Takeout CSV/JSON, discounts motion-artifact readings, tracks `device_silent` gaps, and fetches district-rounded `Open-Meteo` ambient heat & PM2.5 air quality context.

### 2. Personal Baseline & 3-Layer Deterioration Engine (`services/engine` + TS Fallback)
- **Personalized Circadian Baselines:** Context-aware (`sleep`, `rest`, `light_activity`, `exercise`) weighted median & `1.4826 * MAD` dispersion with empirical Bayes shrinkage (`warming_prior` → `learning` → `calibrated`) and quarantine periods (`excluded_periods`).
- **Deterministic 3-Layer Detection:**
  - `L1` hard NEWS2 / COPD Scale-2 physiological bounds
  - `L2` directional Z-score / EWMA / CUSUM + `ruptures.Pelt` structural change-points
  - `L3` `MinCovDet` Mahalanobis distance + `river.HalfSpaceTrees` + `IsolationForest` + Partial NEWS2 scoring with heat/activity confounder suppression
- Built-in deterministic TypeScript evaluation fallback (`fallbackEvaluateLocal`) ensures full scoring availability on Vercel serverless deployments even when external `ENGINE_URL` is not attached.

### 3. Anti-Fatigue Alerting & 5-Step Escalation Ladder (`/alerts`)
- N-of-M persistence, recovery hysteresis (`<24`), cooldown deduplication, daily alert budgets, quiet hours with `urgent` bypass, and bounded feedback sensitivity tuning (`[-0.25, +0.25]`).
- 5-step escalation (`Patient → Primary Caregiver → Secondary Caregiver → Clinician → Emergency 112/108` + OpenStreetMap Overpass nearest hospitals), live Server-Sent Events (`/api/v1/stream`), VAPID Web Push, Email (Resend), `ntfy`, Telegram webhooks, and Cloudflare Email Routing reply worker (`workers/inbox`).

### 4. Role-Isolated Workspaces (`EN` / `ಕನ್ನಡ` / `हिन्दी`)
Each portal has its own dedicated login route and strict RBAC + PostgreSQL RLS isolation:
- **Patient (`Elder Care View`, `/today`, login at `/auth`):**
  - High-contrast elder-friendly dashboard, spoken status read-aloud, one-tap check-in, NLM RxNorm medication checks, and **Wispr Voice Companion** (live waveform + auto-silence VAD, filler-word cleanup, on-device `Xenova/whisper-base` ONNX WASM transcription or optional Groq `whisper-large-v3-turbo`, red-flag `112` safety escalation).
- **Caregiver (`Caregiver Monitor`, `/caregiver`, login at `/caregiver/login`):**
  - Consented elder telemetry, elder voice/manual check-in timeline, live SSE alerts with working **Acknowledge**, **Snooze 2h**, **Escalate Step**, and **Resolve** actions.
- **Clinician (`Clinician Workstation`, `/clinician`, `/clinician/scribe`, `/clinician/report`, login at `/clinician/login`):**
  - **Cohort Triage & Telemetry:** Consented cohort table, interactive Apache ECharts trajectories with personal baseline corridors, Partial NEWS2 breakdown, printable SBAR report, and LOINC FHIR R4 Bundle export.
  - **Ambient OPD Clinical Scribe (`/clinician` tab & `/clinician/scribe`):** Built for high-volume Indian OPDs (60–100 consultations/day) using SENTINEL's zero-external-LLM **Wispr + Deterministic Clinical NLP + NLM RxNorm** stack:
    - Live instant speech recognition (`en-IN` / `kn-IN` / `hi-IN` hot-switching while recording) + on-device `Xenova/whisper-base` fallback with RMS normalization and `isWhisperHallucination` filtering (eliminates silence/ambient `"Thank you."` hallucinations).
    - Real-time **Doctor ↔ Patient speaker diarization** across code-mixed English, Kannada (`ಕನ್ನಡ` & transliterated Kannada), and Hindi (`हिन्दी` & Hinglish).
    - Generates editable **Structured SOAP Note**, **Draft Prescription (Rx with RxCUI & HR-modifier flags)**, and **Patient Summary (`EN / ಕನ್ನಡ / हिन्दी` + browser read-aloud)** saved in `opd_consultations`, with one-click medication sync upon physician approval.

### 5. Privacy, Auditability & Evaluation (`/signals`, `/settings`, `/settings/consent`, `/eval`, `/model-card`)
- Granular per-scope consent grants (`vitals_read`, `alerts_receive`, `checkin_view`, `clinician_export`, `emergency_dispatch`), DPDP Act 2023 full JSON export and `"ERASE MY DATA"` erasure, SHA-256 hash-chained immutable `audit_logs` ledger (`/api/v1/audit/verify`), PostgreSQL `FORCE ROW LEVEL SECURITY` on protected PHI tables, causal walk-forward benchmarks, and Model Card transparency.

---

## Architecture & Project Layout

| Workspace / File | Responsibility |
| :--- | :--- |
| `apps/web` (`@sentinel/web`) | Next.js 16 App Router frontend UI, REST & SSE `/api/v1/**` backend routes, Better Auth + role portal segregation, Drizzle ORM + PostgreSQL (`25` tables) |
| `services/engine` (`sentinel-engine`) | Python 3.12 FastAPI statistical baseline, `L1`/`L2`/`L3` + Partial NEWS2 scoring, PMData/LifeSnaps/WESAD/MMASH dataset loaders & benchmark harness |
| `packages/shared` (`@sentinel/shared`) | Shared Zod contracts, canonical vital units/bounds, AES-256-GCM PHI encryption, API key hashing, audit chain cryptography |
| `workers/inbox` (`@sentinel/inbox-worker`) | Cloudflare Email Routing worker parsing caregiver `OK` / `CALL ME` / `SNOOZE` replies into `/api/v1/webhooks/inbox-reply` |
| `PROJECT_FILE_AND_API_GUIDE.txt` | Full file-by-file map, page-to-API matrix, 25-table schema breakdown, and module reference |

> For the complete route-by-route, file-by-file, and schema mapping, read [PROJECT_FILE_AND_API_GUIDE.txt](PROJECT_FILE_AND_API_GUIDE.txt) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Quick Start (Zero-Docker Local Parity & Production Ready)

**Requirements:** Node.js `22+`, `pnpm 10+`, Python `3.12+` with `uv` (uses Neon/managed `DATABASE_URL` when configured, or auto-boots local embedded PostgreSQL on port `5433`).

```bash
# 1. Configure environment variables in .env.local (see docs/SETUP-NEEDED.md)
cp .env.example .env.local

# 2. Install Node & Python dependencies
pnpm install
cd services/engine && uv sync && cd ../..

# 3. Apply database migrations & start local engine + web server
pnpm db:migrate
pnpm --filter @sentinel/web dev
```

Or run the containerized stack via Docker Compose:

```bash
docker compose up --build
```

Create real **Patient**, **Caregiver**, or **Clinician** accounts on `/auth`, `/caregiver/login`, or `/clinician/login` via **Continue with Google** or Email/Password — all workspaces enforce strict role & PostgreSQL RLS boundaries.

---

## Verification & Quality Gates

```bash
# Typecheck across monorepo + unit suites + Next.js production build
pnpm typecheck
pnpm --filter @sentinel/shared test
pnpm --filter @sentinel/inbox-worker test
pnpm --filter @sentinel/web test      # 12 Vitest suites (incl. opd-scribe, RLS/audit, OAuth, engine)
pnpm --filter @sentinel/web build

# Python statistical detection engine & Hypothesis property checks
cd services/engine && uv run pytest -v

# Playwright + @axe-core/playwright WCAG 2.2 AA end-to-end suite (8 specs across Phases 1-8)
pnpm --filter @sentinel/web test:e2e

# Concurrent HTTP ingestion & health load probe
node scripts/load-test.mjs
```

---

## Documentation Index

- [Complete File Map & Frontend-Backend API Connection Guide](PROJECT_FILE_AND_API_GUIDE.txt)
- [Architecture, Schema, STRIDE Threat Model & Deployment](docs/ARCHITECTURE.md)
- [Model Card & PPG/NEWS2 Limitations](docs/MODEL-CARD.md)
- [External Accounts, OAuth & Free-for-Dev Setup](docs/SETUP-NEEDED.md)
- [3-Minute Live Walkthrough Guide](docs/PITCH.md)
- [Open Source Licenses & Attributions](CREDITS.md)
- [Healthcare UI Design Contract](DESIGN.md)
