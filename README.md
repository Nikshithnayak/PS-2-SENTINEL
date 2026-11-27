# Sachet · SENTINEL

> **Wearable-Based Early Health Awareness & Deterioration Detection System**  
> Hackathon Brief **S2 · Nitte Pharma Innovation Centre** · Live Deployment: [`ps-2-sentinel.vercel.app`](https://ps-2-sentinel.vercel.app)

SENTINEL learns each older adult's personal physiological normal over a 14-day shrinkage-calibrated baseline, detects multi-signal deterioration early via a deterministic 3-layer statistical engine (`L1` safety bounds + `L2` personal temporal/change-point + `L3` multivariate covariance/streaming trees), routes calm anti-fatigue alerts across caregivers and clinicians, and enforces DPDP Act 2023 privacy controls with PostgreSQL `FORCE ROW LEVEL SECURITY` and hash-chained audit logs.

> **Clinical Safety Notice:** SENTINEL is a screening and early-awareness companion tool — **NOT a diagnostic medical device**. Wording frames *"changes from your personal normal"*, never diagnoses, and urgent views surface regional emergency contacts (India default: `112` Emergency, `108` Ambulance).

---

## Core Capabilities

- **Direct Watch & Phone Sync (`/ingest`):**
  - **Google Fit & Google Health v4 OAuth 2.0:** 1-click OAuth connector (`/api/v1/connectors/google/connect`) with AES-256-GCM encrypted refresh tokens.
  - **Android Health Connect Direct Bridge:** One-tap authenticated URL + scannable QR code natively decoding **HC Webhook** payloads (`heart_rate`, `heart_rate_variability_rmssd`, `oxygen_saturation`, `respiratory_rate`, `steps`, `sleep_sessions`, etc.) with zero manual CSV downloads.
  - **Live Web Bluetooth (`0x180D` / `0x2A37`):** Pairs directly from Chrome/Edge to BLE watches and HR straps with RR-interval RMSSD HRV calculation.
  - **Universal Ingestion & Backfill:** Accepts iPhone Health Auto Export / Apple Shortcuts, streaming Apple Health `export.xml`, Google Fit Takeout JSON/CSV, SHA-256 salted API keys (`/api/v1/ingest/watch`), motion-artifact discounting, `device_silent` operational monitoring, and district-rounded `Open-Meteo` heat context.
- **Personal Baseline & 3-Layer Engine (`services/engine` + deterministic TypeScript engine):** Context-aware (`sleep`, `rest`, `light_activity`, `exercise`) weighted median & `1.4826 * MAD` scale, empirical Bayes shrinkage warm-up (`warming_prior` -> `learning` -> `calibrated`), contamination quarantine (`excluded_periods`), `L1` NEWS2/COPD Scale 2 safety bounds, `L2` directional Z/EWMA/CUSUM + `ruptures.Pelt` change-points, `L3` `MinCovDet` Mahalanobis + `river.HalfSpaceTrees` + `IsolationForest`, and transparent Partial NEWS2 scoring.
- **Anti-Fatigue Alerting & Escalation Ladder (`/alerts`):** N-of-M confirmation, recovery hysteresis (`<24`), cooldown deduplication, daily alert budget, quiet hours with `urgent` bypass, bounded sensitivity tuning (`[-0.25, +0.25]`), 5-step escalation (`Patient -> Primary Caregiver -> Secondary Caregiver -> Clinician -> Emergency 112/108` + OpenStreetMap Overpass/Nominatim nearest hospitals), live SSE (`/api/v1/stream`), VAPID Web Push, Email, `ntfy`, Telegram, and Cloudflare Email Routing reply worker (`workers/inbox`).
- **Role-Isolated Accessible Workspaces (`EN` / `ಕನ್ನಡ` / `हिन्दी`):**
  - **Patient (`Elder Care View`, `/today`):** Large-touch light healthcare UI, spoken status read-aloud, **Wispr-Flow-style Conversational Voice Companion** (on-device open-source Whisper AI via `@huggingface/transformers` + optional free Groq `whisper-large-v3-turbo` / Ollama LLM, live microphone waveform & auto-silence VAD, filler-word cleanup, multi-turn natural chat, red-flag `112` safety escalation), and NLM RxNorm medication checks.
  - **Caregiver (`Caregiver Monitor`, `/caregiver`):** Connected elders summary, elder check-in & voice companion transcripts, live SSE alert acknowledgement/snooze/escalation, watch setup links, and emergency `112` routing.
  - **Clinician (`Clinician Workstation`, `/clinician`, `/clinician/report`):** Consented cohort triage, zoomable Apache ECharts trajectories with personal normal bands, window comparison, Partial NEWS2 breakdown, printable SBAR report, and LOINC FHIR R4 Bundle export.
  - **Privacy, Signals & Evaluation (`/signals`, `/settings`, `/settings/consent`, `/eval`, `/model-card`):** Raw signal explorer, contamination quarantine, granular Consent Ledger with hash-chain verifier, DPDP Act 2023 JSON Export / Right-to-Erasure, causal walk-forward benchmarks, and fairness disclosures.

---

## Quick Start (Zero-Docker Local Parity & Production Ready)

**Requirements:** Node.js `22+`, `pnpm 10+`, Python `3.12+` with `uv` (uses Neon/managed `DATABASE_URL` or local PostgreSQL automatically).

```bash
# 1. Configure environment variables in .env.local (see docs/SETUP-NEEDED.md)
cp .env.example .env.local

# 2. Install Node & Python dependencies
pnpm install
cd services/engine && uv sync && cd ../..

# 3. Run database migrations & start FastAPI (8000) + Next.js (3000)
pnpm --filter @sentinel/web db:migrate
pnpm --filter @sentinel/web dev
```

Or run the containerized stack via Docker Compose:

```bash
docker compose up --build
```

Create real **Patient**, **Caregiver**, or **Clinician** accounts directly on `/auth` via **Continue with Google** or Email/Password — all workspaces isolate strictly by PostgreSQL RLS and DPDP consent grants.

---

## Verification & Load Test Commands

```bash
# Monorepo typecheck + unit tests + Next.js production build
pnpm typecheck
pnpm --filter @sentinel/shared test
pnpm --filter @sentinel/inbox-worker test
pnpm --filter @sentinel/web test
pnpm --filter @sentinel/web build

# Python detection engine, Hypothesis property checks & causal ablations
cd services/engine && uv run pytest -v

# Playwright + @axe-core/playwright WCAG 2.2 AA E2E across Phases 1-8
pnpm --filter @sentinel/web test:e2e

# Concurrent HTTP ingestion & health load probe
node scripts/load-test.mjs
```

---

## Documentation Index

- [Architecture, Schema, STRIDE Threat Model & Deployment](docs/ARCHITECTURE.md)
- [Model Card & PPG/NEWS2 Limitations](docs/MODEL-CARD.md)
- [External Accounts, OAuth & Free-for-Dev Setup](docs/SETUP-NEEDED.md)
- [3-Minute Live Walkthrough Guide](docs/PITCH.md)
- [Open Source Licenses & Attributions](CREDITS.md)
- [Healthcare UI Design Contract](DESIGN.md)
