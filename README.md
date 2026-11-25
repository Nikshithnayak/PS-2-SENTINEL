# Sachet · SENTINEL

> **Wearable-Based Early Health Awareness & Deterioration Detection System**  
> Hackathon Brief **S2 · Nitte Pharma Innovation Centre**

SENTINEL learns each older adult's personal physiological normal over a 14-day shrinkage-calibrated baseline, detects multi-signal deterioration early via a deterministic 3-layer statistical engine (`L1` safety bounds + `L2` personal temporal/change-point + `L3` multivariate covariance/streaming trees), routes calm anti-fatigue alerts across caregivers and clinicians, and enforces DPDP Act 2023 privacy controls with PostgreSQL `FORCE ROW LEVEL SECURITY` and hash-chained audit logs.

> **Clinical Safety Notice:** SENTINEL is a screening and early-awareness companion tool — **NOT a diagnostic medical device**. Wording frames *"changes from your personal normal"*, never diagnoses, and urgent views surface regional emergency contacts (India default: `112` Emergency, `108` Ambulance).

---

## Core Capabilities

- **Multi-Source Ingestion & Data Quality (`/ingest`):** Streaming Apple Health `export.xml` parser, Google/Fitbit Takeout JSON & interactive CSV column mapper, SHA-256 salted `x-api-key` Open Ingestion API (`/api/v1/ingest`) with batch idempotency, `ProviderAdapter` contracts (`OpenWearablesAdapter`, `GoogleHealthAdapter`), motion-artifact confidence discounting during step bursts, `device_silent` operational monitoring, district-rounded `Open-Meteo` ambient heat context (zero PII), and 11 seeded physiological simulation scenarios cleanly badged **`SYNTHETIC`**.
- **Personal Baseline & 3-Layer Engine (`services/engine`):** Context-aware (`sleep`, `rest`, `light_activity`, `exercise`) weighted median & `1.4826 * MAD` scale, empirical Bayes shrinkage warm-up (`warming_prior` -> `learning` -> `calibrated`), contamination quarantine (`excluded_periods` + holdout guard), `L1` NEWS2/COPD Scale 2 safety bounds, `L2` directional Z/EWMA/CUSUM + `ruptures.Pelt` change-points, `L3` `MinCovDet` Mahalanobis + `river.HalfSpaceTrees` + `IsolationForest`, and transparent Partial NEWS2 scoring.
- **Anti-Fatigue Alerting & Escalation Ladder (`/alerts`):** N-of-M confirmation, recovery hysteresis (`<24`), cooldown deduplication, daily alert budget, quiet hours with `urgent` bypass, bounded sensitivity feedback tuning (`[-0.25, +0.25]`), 5-step escalation (`Patient -> Primary Caregiver -> Secondary Caregiver -> Clinician -> Emergency 112/108` + OpenStreetMap Overpass/Nominatim nearest hospitals), live SSE (`/api/v1/stream`), VAPID Web Push, Email, `ntfy`, Telegram, flag-gated SMS, and Cloudflare Email Routing reply worker (`workers/inbox`).
- **Role-Specific Accessible UX:**
  - `/today`: Elder Mode (`>=18px` body text, `>=48px` targets, EN/ಕನ್ನಡ/हिन्दी, Web Speech Read-Aloud, Voice Check-In Companion with barge-in, one-tap check-in & NLM RxNorm medication adherence).
  - `/caregiver`: Real-time Care Circle console with SSE alert acknowledgement/snooze/escalation.
  - `/clinician` & `/clinician/report`: Consented cohort triage, zoomable Apache ECharts trajectories with personal normal bands, window comparison, Partial NEWS2 breakdown, Printable PDF report, and LOINC FHIR R4 Bundle export.
  - `/signals`, `/settings`, `/settings/consent`: Raw Signal Explorer, Quarantine Manager, Granular Consent Ledger, Hash-Chain Verifier, and DPDP Act 2023 JSON Export / Right-to-Erasure.
  - `/eval` & `/model-card`: Live walk-forward causal benchmark runner (`fixed_clinical_only` vs `L1_L2_personal` vs `L1_L2_L3_full`), public dataset schema adapters (`PMData`, `LifeSnaps`, `WESAD`, `MMASH`), and equity/PPG limitation disclosures.

---

## Quick Start (Zero-Docker Local Parity)

**Requirements:** Node.js `22+`, `pnpm 10+`, Python `3.12+` with `uv` (PostgreSQL runs automatically via embedded PostgreSQL TCP cluster — no Docker Desktop required!).

```bash
# 1. Install Node & Python dependencies
pnpm install
cd services/engine && uv sync && cd ../..

# 2. Boot PostgreSQL (auto-initialized UTF-8 on 5433), run migrations + seed, start FastAPI (8000) & Next.js (3000)
pnpm --filter @sentinel/web dev
```

Or run the containerized stack via Docker Compose:

```bash
docker compose up --build
```

### Seeded Demo Accounts (Local Dev)
All seeded accounts use password **`SentinelDemo#2026`** and can be selected directly on `/auth`:
- **Patient (Elder):** `ramesh@sentinel.local`
- **Primary Caregiver:** `kavitha@sentinel.local`
- **Clinician:** `dr.shetty@sentinel.local`
- **Org Admin / Researcher:** `research@sentinel.local`

---

## Verification & Load Test Commands

```bash
# Monorepo typecheck + all unit/integration tests + Next.js production build
pnpm typecheck
pnpm --filter @sentinel/shared test
pnpm --filter @sentinel/inbox-worker test
pnpm --filter @sentinel/web test
pnpm --filter @sentinel/web build

# Python detection engine, Hypothesis property checks & causal ablations
cd services/engine && uv run pytest -v

# Playwright + @axe-core/playwright WCAG 2.2 AA E2E across Phases 1-8
pnpm --filter @sentinel/web test:e2e

# Concurrent HTTP ingestion & health load probe (against running local/CI server)
node scripts/load-test.mjs
```

---

## Documentation Index

- [Architecture, Schema, STRIDE Threat Model & Deployment](docs/ARCHITECTURE.md)
- [Model Card & PPG/NEWS2 Limitations](docs/MODEL-CARD.md)
- [Optional Credentials & Adapter Configuration](docs/SETUP-NEEDED.md)
- [3-Minute Demo Script](docs/PITCH.md)
- [Open Source Licenses & Attributions](CREDITS.md)
- [Healthcare UI Design Contract](DESIGN.md)
