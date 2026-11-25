# Phase 2 Plan: Data Layer

- **Phase:** 2 of 9
- **Requirements Covered:** `REQ-ING-01`, `REQ-ING-02`, `REQ-ING-03`, `REQ-ING-04`, `REQ-ING-05`, `REQ-QUAL-01`, `REQ-QUAL-02`, `REQ-QUAL-03`, `REQ-QUAL-04`

## Tasks
1. **ProviderAdapter & Quality Pipeline (`apps/web/src/lib/ingestion/`):**
   - `ProviderAdapter` interface + `OpenWearablesAdapter` + `GoogleHealthAdapter` (v4 endpoints, env-gated with clean diagnostic fallback).
   - Data Quality Pipeline (`quality.ts`): UTC normalization, unit normalization, physical bounds rejection, deduplication (`sourceHash`), motion-artifact flagging when resting HR/HRV/SpO₂/RR coincides with active `steps` or `exercise`, per-sample `dataConfidence`, hourly rollup upsert (`vital_rollups_hourly`), and `device_silent` safety check (`checkDeviceSilence`).
2. **Ingestion API & Key Management (`/api/v1/ingest`, `/api/v1/api-keys`, `/api/v1/context/environment`):**
   - `POST /api/v1/ingest`: authenticates via `x-api-key` (`api_keys.key_hash`) OR patient session, enforces batch idempotency (`ingest_batches`), runs quality pipeline, updates `vital_samples` + `vital_rollups_hourly` + `audit_logs`.
   - Open-Meteo ambient weather/heat/AQI fetcher using rounded `region_lat`/`region_lon` only (zero PII), populating `environment_snapshots` and heat confounder risk.
3. **Importers (`importers/` + `/api/v1/import/*`):**
   - Streaming Apple Health `export.xml` parser (SAX/chunked stream regex/stateful tag parser — zero full-DOM memory blowup, HealthKit `%` 0–1 -> 0–100 conversion, `degF` -> `degC`, `XMLParseStats` accepted/skipped counts).
   - Google/Fitbit Takeout JSON/CSV parser + Generic CSV parser with interactive column-to-metric & unit mapping.
4. **Physiological Synthetic Scenario Generator (`services/engine/sim/` + `/api/v1/sim/generate`):**
   - Seeded multi-day realistic physiological simulator (`numpy`/`pandas`) generating circadian HR, RHR, HRV, SpO₂, RR, skin temp deviation, steps, sleep duration/efficiency/awakenings, artifacts, and 8 labeled scenarios (`baseline_stable`, `early_infection`, `hf_decompensation`, `copd_exacerbation`, `arrhythmia_episode`, `dehydration_heat`, `post_discharge_decline`, `missed_medication`, `fall_event`, `exercise_confounder`, `off_wrist_silence`).
   - All generated rows carry `is_synthetic = true` and `source = 'synthetic_sim'`.
5. **Data & Import UI (`/ingest`) + Verification:**
   - Real upload/import console (Apple XML upload, CSV column mapper, API key generator, Open-Meteo environmental card, and explicitly `SYNTHETIC`-badged scenario loader).
   - Unit tests (Apple XML streaming fixture, Takeout/CSV mapper, motion-artifact/silence flags, Open-Meteo no-PII sanitizer), Python `sim` pytest tests, and Playwright + axe verification with screenshots in `docs/evidence/phase-2/`.
