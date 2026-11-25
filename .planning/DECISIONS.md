# Architectural & Product Decisions Log — SENTINEL

> Every non-trivial product, clinical, UX, and engineering choice is logged here with **Options**, **Choice**, and **Reason**, grounded in Phase 0 research, the 6-persona self-interview panel, and the gstack pressure-test.

---

## Part A: Self-Interview Panel (Phase 0 Step 3)

We convened six domain stakeholders to pressure-test every assumption before writing code:

1. **72-year-old Kannada-speaking patient (Ramesh, retired shopkeeper in Mangaluru, basic Android phone, presbyopia, mild arthritic tremor)**
   - *Core pain:* Complex smartwatch dashboards, tiny 12px gray English numbers, and alarming red "ABNORMAL HEART RATE" banners cause panic or abandonment within 3 days. Needs huge tap targets, Kannada voice/read-aloud, and simple daily reassurance.
2. **Working daughter caregiver (Kavitha, 41, software QA lead in Bengaluru, caring remotely)**
   - *Core pain:* Can't install yet another noisy wellness app that pings every time Ramesh climbs stairs or charges his watch. Needs quiet confidence when normal, clear actionable email/Telegram alerts with context ("Resting HR stayed +14 bpm above Ramesh's 3-week normal for 6 hours overnight"), and one-reply acknowledgement (`OK`, `CALL ME`, `SNOOZE`) even during meetings.
3. **Geriatrician / Cardiologist (Dr. Shetty, outpatient consultant in Mangaluru)**
   - *Core pain:* Patients bring screenshots of uncalibrated watch numbers without knowing baseline, medications (e.g., beta-blockers), or motion artifacts. Needs zoomed multi-day time-series with personal baseline bands (`±1σ / ±2σ`), medication overlays, data-confidence indicators, partial NEWS2 breakdown showing clearly what's missing (no cuff BP), and 1-click PDF / FHIR R4 export.
4. **Nitte Pharma Innovation Centre R&D Lead**
   - *Core pain:* Hackathon demos look shiny with hardcoded JSON but collapse under real Apple Health XML exports or clinical scrutiny. Wants reproducible validation (seeded scenarios + public datasets like LifeSnaps/WESAD/PMData), honest ablation tables showing why statistical personal baselines beat fixed thresholds, and de-identified cohort analytics.
5. **Privacy & Security Officer (India DPDP Act 2023 & OWASP ASVS L2)**
   - *Core pain:* Elderly health data leaked to external LLM APIs or third-party weather/drug lookups. Demands strict consent ledgers, withdrawal & erasure flows, encrypted identifiers, de-identified external calls, hash-chained audit logs, and zero PII sent to any LLM phrasing adapter.
6. **Skeptical Hackathon Judge**
   - *Core pain:* "Is this just `if hr > 100: alert()` wrapped in Next.js with fake numbers and an 'AI-powered' badge?" Demands full traceability from raw DB sample -> quality flag -> baseline state -> L1/L2/L3 contributions -> detector decision log -> alert outbox -> dashboard acknowledgment, plus real browser proof.

---

## Part B: Recorded Decisions (`DEC-*`)

### `DEC-001` — GSD Process Emulation vs Interactive CLI Installer
- **Options:** (A) Run interactive `npx get-shit-done-cc@latest` slash commands; (B) Emulate GSD artifact structure cleanly under `.planning/` (`PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, per-phase `PLAN.md` & `VERIFICATION.md`, `DECISIONS.md`, `ASSUMPTIONS.md`, `RISKS.md`, `UNDERSTANDING.md`).
- **Choice:** **Option B** (emulate GSD under `.planning/`).
- **Reason:** GSD slash commands are interactive UI prompts and not installed in the workspace; per Section 2, explicit GSD files under `.planning/` preserve exact session resumability without blocking.

### `DEC-002` — Wearable Data Layer Strategy (Post-Fitbit Web API Shutdown)
- **Options:** (A) Direct Fitbit Web API OAuth integration; (B) Direct-only custom parsers; (C) Own `ProviderAdapter` abstraction supporting direct file importers (streaming Apple Health `export.xml`, Google/Fitbit Takeout JSON/CSV, generic CSV column mapper), authenticated Ingestion API keys, Synthetic mode, optional `Google Health API` adapter, and optional `the-momentum/open-wearables` connector.
- **Choice:** **Option C**.
- **Reason:** Verified in Phase 0 research that Google permanently shut down the legacy Fitbit Web API on Nov 2, 2026 (`410 Gone`), migrating to Google Health API (`v4` endpoints requiring partner/OAuth review). Building behind our own `ProviderAdapter` contract lets real Apple Health exports, Takeout archives, CSVs, and REST pushes work out-of-the-box with zero vendor lock-in while remaining compatible with Open Wearables.

### `DEC-003` — Local PostgreSQL Parity Without Host Docker Desktop
- **Options:** (A) Require Docker Desktop / manual host PostgreSQL install (blocked on this Windows host where Docker and `psql` are absent); (B) Use SQLite in dev and Postgres in prod (breaks RLS, partitioning, `LISTEN/NOTIFY`, and SQL parity); (C) Use real PostgreSQL in `docker-compose.yml` **plus** `embedded-postgres` (MIT) / PGlite TCP bridge as an automatic zero-Docker local dev/test PostgreSQL server.
- **Choice:** **Option C** (`docker-compose.yml` uses official Postgres/TimescaleDB for containerized deployments; local Windows dev/CI auto-boots a real PostgreSQL instance via `embedded-postgres` when `DATABASE_URL` isn't already running).
- **Reason:** Ensures BOTH `apps/web` (Drizzle + Better Auth + RLS + partitioned tables) and `services/engine` (Python `psycopg`) execute against genuine PostgreSQL semantics during local tests and Playwright runs on this host, while keeping `docker compose up` 100% standard.

### `DEC-004` — Detection Philosophy: Deterministic Statistical Core vs LLM Decisioning
- **Options:** (A) Send patient vitals to an LLM to decide if deterioration is happening; (B) Strictly deterministic, seeded Python statistical core (L1 clinical safety bounds + L2 personal MAD z-scores/EWMA/CUSUM/ruptures + L3 Mahalanobis/Half-Space Trees/Isolation Forest), with an optional de-identified LLM adapter strictly for plain-language explanation phrasing.
- **Choice:** **Option B**.
- **Reason:** Clinical safety requires auditability, exact reproducibility, zero hallucinated alerts, sub-second latency, and zero PII leakage. Every alert emits a structured `DetectorDecisionLog` showing exact feature deltas and rule contributions.

### `DEC-005` — Brand & Naming Strategy (Working Name `SENTINEL` -> Phase 1 Brand Identity)
- **Options:** (A) Keep `SENTINEL` permanently everywhere; (B) Select an original, culturally resonant Phase 1 clinical product name (e.g., **PranaPulse** / **Sachet** — meaning *watchful/aware* in Kannada *ಸಚೇತ* & Hindi *सचेत*) while keeping technical monorepo scope `@sentinel/*` consistent across docs and packages.
- **Choice:** **Option B** (Lock exact brand display name **Sachet (SENTINEL)** — or **ArogyaSentinel** — in Phase 1 Foundations alongside `DESIGN.md`; use `@sentinel/*` internally). Let's adopt **Sachet · SENTINEL** (*Sachet: Wearable Early-Awareness Platform*) in Phase 1 so elders in Karnataka recognize a warm, trustworthy name while hackathon evaluators trace it directly to the SENTINEL brief.
- **Reason:** Respects Section 0 ("SENTINEL (working name, rename it in Phase 1)") and the Kannada elder persona's need for non-intimidating, culturally familiar naming.

### `DEC-006` — Visual Design System Direction (Overriding Neumorphism Accessibility Risk)
- **Options:** (A) Adopt `ui-ux-pro-max-skill`'s literal style hit ("Neumorphism" soft embossed UI); (B) Keep its verified **Atkinson Hyperlegible** typography + clinical calm cyan/emerald/crimson palette, but replace low-contrast neumorphic shadows with high-contrast flat clinical-editorial surfaces (`#F8FAFC` / `#0B1117`), `JetBrains Mono` (`tabular-nums`) for vitals, and `Fraunces` or `Instrument Serif` / `Plus Jakarta Sans` display headings.
- **Choice:** **Option B**.
- **Reason:** `ui-ux-pro-max-skill` itself flagged `Neumorphism` as `Accessibility: risk:high` due to soft gray-on-gray contrast failing elderly low-vision users and WCAG 2.2 AA (`4.5:1`). High-contrast surfaces with `Atkinson Hyperlegible` + `Noto Sans Kannada` + `Noto Sans Devanagari` achieve WCAG 2.2 AA/AAA legibility.

### `DEC-007` — `paper-design/liquid-logo` License Compliance
- **Options:** (A) Copy code from `paper-design/liquid-logo` into `apps/web`; (B) Avoid copying `liquid-logo` (PolyForm Shield 1.0.0 non-compete license) and instead use Apache-2.0 `@paper-design/shaders-react` (or a clean custom SVG + WebGL brand mark).
- **Choice:** **Option B**.
- **Reason:** PolyForm Shield 1.0.0 includes broad non-compete restrictions that could conflict with open-source/commercial healthcare deployment; `@paper-design/shaders-react` is cleanly Apache-2.0.

### `DEC-008` — Voice Check-In Architecture (Phase 7)
- **Options:** (A) Embed full `Open-LLM-VTuber` Python server + Live2D proprietary runtime in the main app; (B) Build a lightweight, privacy-preserving browser Web Audio + VAD + multi-language (`en`/`kn`/`hi`) voice/tap check-in client backed by deterministic symptom extraction + browser SpeechRecognition/SpeechSynthesis (`edge-tts` server fallback), plus optional WebSocket bridge to self-hosted `Open-LLM-VTuber`.
- **Choice:** **Option B**.
- **Reason:** Avoids proprietary `LICENSE-Live2D.md` redistribution issues, keeps Docker images lean and fast (`LCP < 2.5s`), guarantees instant offline-capable one-tap fallback on budget Android phones, and respects elder zero-jargon UX.

### `DEC-009` — NEWS2 Integration Honesty
- **Options:** (A) Fabricate missing BP and consciousness values to show a full 0–20 NEWS2 score; (B) Compute SENTINEL's native **Deterioration Index (0–100)** from wearable signals AND show a **Wearable-Supported Partial NEWS2 View** that transparently labels Systolic BP and ACVPU as `Not measured (manual cuff / check-in required)`.
- **Choice:** **Option B**.
- **Reason:** Clinically honest and aligned with RCP NEWS2 guidelines; avoids false reassurance or fabricated clinical scores.

### `DEC-010` — Alert Fatigue Guardrails & Escalation Budget
- **Options:** (A) Fire instant push/email on every 5-minute threshold crossing; (B) Implement strict persistence (`N of M` low-motion windows), hysteresis recovery bands, per-rule cooldowns, daily non-urgent alert budget (default 3/day), quiet hours (`22:00–07:00` IST, bypassed only by `Urgent`), incident deduplication, and timed escalation ladder (Patient Nudge -> Primary Caregiver -> Secondary Caregiver -> Clinician -> Emergency 112/108 Prompt).
- **Choice:** **Option B**.
- **Reason:** Directly grounded in Drew et al. (2014) and Cvach (2012) findings showing 80–99% false alarms destroy trust.

### `DEC-011` — Monorepo & Contract Single Source of Truth
- **Options:** (A) Duplicate TypeScript and Python data models manually; (B) Define canonical enums, metric units, and event schemas in `packages/shared` (Zod -> generated JSON Schema) consumed by `apps/web` and validated/mirrored via codegen or schema contract tests against `services/engine` Pydantic models.
- **Choice:** **Option B**.
- **Reason:** Prevents schema drift (`heart_rate` vs `hr`, `%` vs `0..1` fraction) across the Next.js/FastAPI boundary.

### `DEC-012` — Hosting & Free-Tier Deployment Target
- **Options:** (A) Paid AWS/GCP enterprise cluster; (B) Free-tier architecture documented via `free-for-dev`: **Vercel** (Next.js frontend, free SSL + edge CDN), **Neon** (managed Postgres 0.5 GB / 100 CU-hrs free) or **Supabase** (Postgres + Storage), **Render** or **Koyeb** (Python FastAPI engine free tier, 512 MB RAM), **Cloudflare Workers** (`workers/inbox` Email Routing, 100k req/day free), **Resend** (3,000 emails/mo free), **Telegram Bot API** + **ntfy.sh** (free), **GlitchTip / Sentry** (free error tracking).
- **Choice:** **Option B** (documented in ADR + `docs/ARCHITECTURE.md`), alongside self-contained `docker-compose.yml` for clinic/on-prem Nitte Pharma hosting.
- **Reason:** Fits zero-cost hackathon and pilot clinic budgets while staying fully portable to self-hosted clinic servers.
