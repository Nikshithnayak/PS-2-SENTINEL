# Sachet · SENTINEL — Complete API & External Integration Audit

All routes below were verified directly against route handlers under `apps/web/src/app/api/**`, `services/engine/app/main.py`, and frontend fetch/mutation callers. Security headers (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on `/api/*`) are enforced by `apps/web/src/proxy.ts`.

---

## 1. Next.js Web & API Route Inventory (`apps/web/src/app/api`)

| Method(s) | Route | Source File | Auth & RBAC Check | Request Validation | Persistence / Downstream | Primary Frontend Caller(s) |
|---|---|---|---|---|---|---|
| `GET` | `/api/health` | `src/app/api/health/route.ts` | Public probe | None | SQL `SELECT 1` + Python `/healthz` or `builtin://ts-engine` mode | Uptime / deployment checks |
| `GET, POST` | `/api/auth/[...all]` | `src/app/api/auth/[...all]/route.ts` | Better Auth + Google `gfit_` state intercept | Better Auth + HMAC state check | `user`, `session`, `account`, `verification`, `audit_logs` | `/auth`, `/caregiver/login`, `/clinician/login`, Google Fit callback |
| `GET` | `/api/v1/auth/providers` | `src/app/api/v1/auth/providers/route.ts` | Public (non-secret status) | None | Env inspection only | `components/auth/portal-auth-screen.tsx` |
| `POST` | `/api/v1/auth/portal-intent` | `src/app/api/v1/auth/portal-intent/route.ts` | Public | `PortalIntentSchema` | Signed `HttpOnly` cookie `sentinel_portal_role` | `components/auth/portal-auth-screen.tsx` |
| `GET` | `/auth/oauth-complete` | `src/app/auth/oauth-complete/route.ts` | Better Auth session | Signed portal cookie check | Promotes user role on portal login & creates `patient_profiles` | OAuth redirect target |
| `GET` | `/api/v1/connectors/google/connect` | `src/app/api/v1/connectors/google/connect/route.ts` | Session + `vitals_read` scope | `PatientIdSchema` (UUID) | Sets `sentinel_gconn_state` cookie, redirects to Google OAuth | `components/ingest/watch-sync-hub.tsx` |
| `GET` | `/api/v1/connectors/google/callback` | `src/app/api/v1/connectors/google/callback/route.ts` -> `google-callback-handler.ts` | Session + `gfit_` CSRF cookie verify | OAuth `code` + state match | Encrypts/stores tokens in `account`, triggers 336h initial pull | Google OAuth redirect |
| `GET, DELETE` | `/api/v1/connectors/google/status` | `src/app/api/v1/connectors/google/status/route.ts` | `requireSession()` | `?mode=fit \| health` | Reads/clears `account` connector rows + `needsReconnect` check | `/ingest` (`WatchSyncHub`) |
| `POST` | `/api/v1/sync/provider` | `src/app/api/v1/sync/provider/route.ts` | `requireSession()` + `checkPatientScope` (`vitals_read`) | `SyncProviderSchema` (`open_wearables \| google_fit \| google_health_api`, `hoursBack` 1..720 default 336) | Pulls provider API -> `ingestVitalBatch` -> `runAndPersistEvaluation` -> alert check | `WatchSyncHub` (`/ingest`) |
| `POST` | `/api/v1/ingest` | `src/app/api/v1/ingest/route.ts` | `resolveIngestAuth` (`x-api-key` / `Bearer snt_...` / `?apiKey=` OR session) | `IngestBatchSchema` (`@sentinel/shared`) | `ingest_batches`, `vital_samples`, `vital_rollups_hourly`, `audit_logs` | External clients, Web BLE button in `WatchSyncHub` |
| `GET, POST` | `/api/v1/ingest/watch` | `src/app/api/v1/ingest/watch/route.ts` | `resolveIngestAuth` (`x-api-key` / `Bearer` / `?apiKey=` / session) | `UuidSchema` + `normalizeWatchPayload` | Normalizes Health Connect / Health Auto Export / flat JSON -> `ingestVitalBatch` -> optional engine evaluation | Android Health Connect QR webhook, Apple Shortcuts / Health Auto Export, Tasker |
| `POST` | `/api/v1/import/apple-xml` | `src/app/api/v1/import/apple-xml/route.ts` | `requireSession()` + `vitals_read` | Multipart `file` (`export.xml`) | Streaming chunk parser -> `ingestVitalBatch` (`apple_health_xml`) | `/ingest` XML uploader |
| `POST` | `/api/v1/import/csv-takeout` | `src/app/api/v1/import/csv-takeout/route.ts` | `requireSession()` + `vitals_read` | `ImportRequestSchema` (`csv \| takeout_json`) | Fitbit Takeout / Google Fit Takeout / CSV mapper -> `ingestVitalBatch` | `/ingest` CSV & Takeout uploader |
| `GET, POST, DELETE` | `/api/v1/api-keys` | `src/app/api/v1/api-keys/route.ts` | `requireSession()` (patient principal) | `CreateKeySchema` | Generates `snt_live_...` SHA-256 hashed key in `api_keys` + `audit_logs` | `/ingest` Device API Key manager |
| `GET` | `/api/v1/quality/status` | `src/app/api/v1/quality/status/route.ts` | `requireSession()` + `vitals_read` | Optional `patientId` | Aggregates `ingest_batches`, `vital_samples` counts, `motion_artifact`, silence, adapter readiness | `/ingest` status & batch history |
| `GET` | `/api/v1/vitals/series` | `src/app/api/v1/vitals/series/route.ts` | `requireSession()` + `vitals_read` | `?metric=...&window=24h\|7d\|30d` | `loadVitalsSeries` (includes calm `heart_rate` fallback for `resting_heart_rate`, baseline band, changePoints, alerts, med markers) | `/today`, `/caregiver`, `/clinician`, `/signals` |
| `GET` | `/api/v1/dashboard/patient` | `src/app/api/v1/dashboard/patient/route.ts` | `requireSession()` + (`vitals_read` or `alerts_receive`) | Optional `patientId` | `loadPatientDashboard` + `detectionTimeline` + hospitals | `/today`, `/caregiver`, `/clinician`, `/clinician/report`, `/signals` |
| `GET` | `/api/v1/clinician/cohort` | `src/app/api/v1/clinician/cohort/route.ts` | `requireSession()` + active `consent_grants` filter | None | `loadCohortSummaries` triage-ranked | `/caregiver`, `/clinician`, `/clinician/scribe` |
| `GET, POST` | `/api/v1/clinician/scribe` | `src/app/api/v1/clinician/scribe/route.ts` | `requireSession()` + patient consent check | `ScribePostSchema` (`generate`, `approve`, `delete`) | Deterministic multilingual EN/KN/HI SOAP & Rx builder -> `opd_consultations` + optional `medications` sync | `/clinician` & `/clinician/scribe` |
| `GET, POST` | `/api/v1/engine/evaluate` | `src/app/api/v1/engine/evaluate/route.ts` | `requireSession()` + `vitals_read` | `EvaluateBodySchema` | Calls Python `/v1/score/evaluate` or `fallbackEvaluateLocal` (`ts-fallback.ts`) -> persists `baseline_states`, `risk_assessments`, `detector_decision_logs` | `/ingest`, `/alerts`, `/today` |
| `POST` | `/api/v1/engine/benchmark` | `src/app/api/v1/engine/benchmark/route.ts` | `requireSession()` | `BenchmarkBodySchema` | Python `/v1/eval/benchmark` or `runTsCausalBenchmarkFallback` on Vercel | `/eval` |
| `GET` | `/api/v1/datasets` | `src/app/api/v1/datasets/route.ts` | `requireSession()` | None | Python `/v1/datasets` or `FALLBACK_CATALOG` (PMData, LifeSnaps, WESAD, MMASH metadata) | `/eval` |
| `GET, DELETE` | `/api/v1/alerts` | `src/app/api/v1/alerts/route.ts` | `requireSession()` + `vitals_read`/`alerts_receive` | Optional `patientId` | Reads/clears patient `alerts` and `alert_deliveries` | `/alerts` |
| `POST` | `/api/v1/alerts/[id]/ack` | `src/app/api/v1/alerts/[id]/ack/route.ts` | `requireSession()` + `alerts_receive`/`vitals_read` | `AckBodySchema` (`acknowledge \| snooze \| escalate \| resolve` + feedback) | `applyAlertAction` -> `alerts`, `patient_profiles.sensitivity_offset`, `audit_logs`, SSE emit | `/caregiver`, `/alerts` |
| `POST` | `/api/v1/alerts/escalate` | `src/app/api/v1/alerts/escalate/route.ts` | `requireSession()` + scope check | `EscalateSchema` | `escalateAlerts` + `processOutboxBatch` | `/alerts` |
| `GET` | `/api/v1/stream` | `src/app/api/v1/stream/route.ts` | `requireSession()` + scope check | Optional `patientId` | SSE stream with 15s keepalive & 45s graceful close (`retry: 2000`) | `/caregiver`, `/alerts` |
| `GET, POST` | `/api/v1/push/subscribe` | `src/app/api/v1/push/subscribe/route.ts` | `requireSession()` | `SubscribeSchema` (`endpoint`, `p256dh`, `auth`) | Stores subscription in `push_subscriptions` | Browser Web Push opt-in |
| `GET, POST` | `/api/v1/checkins` | `src/app/api/v1/checkins/route.ts` | `requireSession()` + `checkin_view`/`vitals_read` | `CheckinSchema` | Inserts `checkin_events` + `audit_logs` | `/today` Quick Check-In buttons |
| `POST` | `/api/v1/voice/checkin` | `src/app/api/v1/voice/checkin/route.ts` | `requireSession()` + `checkin_view`/`vitals_read` | `VoiceCheckinSchema` | Conversational EN/KN/HI parser + red-flag check-in/outbox dispatch | `components/voice/voice-checkin.tsx` (`/today`) |
| `GET, POST` | `/api/v1/voice/transcribe` | `src/app/api/v1/voice/transcribe/route.ts` | `GET` public capability probe; `POST` `requireSession()` | Multipart `audio` blob <= 15 MB | Proxies to `GROQ_API_KEY` / `WHISPER_LOCAL_URL` / `OPENAI_API_KEY`, else `501` (`browser_whisper` fallback) | `voice-checkin.tsx`, `opd-scribe-workspace.tsx` |
| `GET, POST` | `/api/v1/medications` | `src/app/api/v1/medications/route.ts` | `requireSession()` + `vitals_read` | `MedPostSchema` (`add_medication \| log_dose`) | RxNorm lookup + `medications`, `medication_events` | `/today` medication panel |
| `GET, POST, DELETE` | `/api/v1/exclusions` | `src/app/api/v1/exclusions/route.ts` | `requireSession()` + `vitals_read` | `ExclusionCreateSchema` (`illness \| hospital \| travel \| device_swap \| medication_change \| other`) | Inserts/deletes `excluded_periods` + `audit_logs` | `/signals` quarantine UI |
| `POST` | `/api/v1/context/environment` | `src/app/api/v1/context/environment/route.ts` | `requireSession()` + `vitals_read` | `{ patientId? }` | Rounded coordinates -> Open-Meteo weather & PM2.5 -> `environment_snapshots` | `/today`, `/caregiver` |
| `GET` | `/api/v1/emergency/hospitals` | `src/app/api/v1/emergency/hospitals/route.ts` | `requireSession()` + scope | Optional `patientId` | District-rounded OSM Overpass API + Mangaluru reference fallback | `/alerts`, `/today` |
| `GET, POST` | `/api/v1/consent` | `src/app/api/v1/consent/route.ts` | `requireSession()` | `ConsentGrantMutationSchema` | Append-only grant/withdraw events in `consent_grants` + `audit_logs` | `/settings/consent` |
| `GET, POST` | `/api/v1/care-circle` | `src/app/api/v1/care-circle/route.ts` | `requireSession()` (patient invites) | `InviteSchema` | Links existing user / creates invite in `care_circle_members` & default `consent_grants` | `/settings/consent` |
| `GET` | `/api/v1/audit/verify` | `src/app/api/v1/audit/verify/route.ts` | `requireSession()` | None | `verifyAuditChain` on up to 500 `audit_logs` entries | `/settings/consent` |
| `GET` | `/api/v1/privacy/export` | `src/app/api/v1/privacy/export/route.ts` | `requireSession()` + `vitals_read` | Optional `patientId` | DPDP Act 2023 full JSON bundle export + `audit_logs` | `/settings` |
| `POST` | `/api/v1/privacy/erase` | `src/app/api/v1/privacy/erase/route.ts` | `requireSession()` (`patient` principal or `org_admin`) | `EraseSchema` (`confirmPhrase === "ERASE MY DATA"`) | Scrubs PII columns, sets `deleted_at`, revokes grants/keys, keeps audit chain intact | `/settings` |
| `GET` | `/api/v1/export/fhir` | `src/app/api/v1/export/fhir/route.ts` | `requireSession()` + `clinician_export`/`vitals_read` | Optional `patientId` | `buildFhirR4Bundle` LOINC FHIR R4 JSON | `/clinician/report` |
| `GET` | `/api/v1/export/cohort-deidentified` | `src/app/api/v1/export/cohort-deidentified/route.ts` | `requireSession()` + `clinician \| org_admin` | None | Pseudonymized SHA-256 participant export filtered by `clinician_export` consent | `/clinician` / research export |
| `GET, PATCH` | `/api/v1/settings/profile` | `src/app/api/v1/settings/profile/route.ts` | `requireSession()` + `vitals_read` | `ProfileUpdateSchema` | Updates `patient_profiles` thresholds, quiet hours, locale, condition modules | `/settings` |
| `POST` | `/api/v1/webhooks/inbox-reply` | `src/app/api/v1/webhooks/inbox-reply/route.ts` | `x-inbox-secret` OR authenticated session | `InboxReplySchema` + `parseCaregiverReplyCommand` | Applies `acknowledge \| escalate \| snooze` on latest open alert | `workers/inbox/src/index.ts` (Cloudflare Email Worker) |
| `POST` | `/api/v1/webhooks/telegram` | `src/app/api/v1/webhooks/telegram/route.ts` | `x-telegram-bot-api-secret-token` (when env set) | Telegram Update / Callback Query | Parses `/ok`, `/callme`, `/snooze` -> `applyAlertAction` | Telegram Bot webhook |

---

## 2. Python Engine & Worker Endpoints

- **FastAPI Statistical Engine (`services/engine/app/main.py`):**
  - `GET /healthz`, `GET /readyz`: Liveness/readiness probes.
  - `POST /v1/score/evaluate`: Full Python baseline + L1/L2/L3 + Partial NEWS2 evaluation (`baseline.py`, `detectors.py`, `features.py`, `conditions.py`).
  - `POST /v1/eval/benchmark`: Causal walk-forward ablation benchmark (`eval_harness.py`).
  - `GET /v1/datasets`, `POST /v1/sim/generate`: Public dataset adapter catalog (`loaders.py`) and synthetic generator (`sim/generator.py`).
- **Cloudflare Email Reply Worker (`workers/inbox/src/index.ts`):**
  - `email(message, env)`: Strips RFC822 MIME quoted reply lines and forwards `{ fromEmail, bodyText }` with `X-Inbox-Secret` header to `SENTINEL_WEBHOOK_URL` (`/api/v1/webhooks/inbox-reply`).

---

## 3. External Integration Readiness & Gaps

| Integration | Code Status | Auth / Env Required | Verified State in Audit |
|---|---|---|---|
| **Google Fit REST API (`fitness.googleapis.com`)** | Rebuilt (`providers.ts` + `google-cloud-health.ts`) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, Google Fit API enabled + Fitness scopes consented | **Unit-verified** via mocked `fetch` for aggregate, `dataSources`, raw `datasets`, Sleep Sessions (`activityType=72`), stage codes `1..6`, and `403` errors. **Live Google user token pull NOT VERIFIED** (requires OAuth consent on real user phone/account). |
| **Google Health API v4 (`health.googleapis.com/v4`)** | Adapter present (`providers.ts`) | `GOOGLE_HEALTH_CLIENT_ID/SECRET` or Google allowlist | Honest error when unconfigured/403; live endpoint **NOT VERIFIED**. |
| **Open Wearables Self-Hosted** | Adapter present (`providers.ts`) | `OPEN_WEARABLES_URL`, `OPEN_WEARABLES_API_KEY` | Mocked HTTP 200 & unconfigured 400 tested in `watch-sync.test.ts`. |
| **Android Health Connect / Apple Shortcuts Webhook** | Active (`/api/v1/ingest/watch`) | Per-patient `snt_live_...` API key | Verified in `watch-sync.test.ts` and `phase2.spec.ts` E2E. |
| **Web Bluetooth (`0x180D` HR Service)** | Implemented in browser UI (`watch-sync-hub.tsx`) | Chrome HTTPS + BLE strap | Packet parser `0x2A37` (uint8/uint16 HR + RR -> RMSSD) unit-tested in `watch-sync.test.ts`; live BLE radio **NOT VERIFIED**. |
| **Open-Meteo Weather & PM2.5 + OSM Overpass** | Implemented (`open-meteo.ts`, `emergency.ts`) | None (district-rounded lat/lon only) | `buildSanitizedOpenMeteoUrls` tested; live API fallback handles network failure safely. |
| **Notification Channels (SSE, Push, Email, ntfy, Telegram, SMS)** | Implemented (`outbox.ts`, `adapters.ts`) | `VAPID_*`, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`, `NTFY_*`, `TWILIO_*` | SSE + DB outbox + `in_app` verified in Vitest + Playwright; external carrier delivery **NOT VERIFIED** without live keys. |
