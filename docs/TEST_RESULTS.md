# Sachet · SENTINEL — Executed Verification & Test Results

All checks below were executed cleanly against the final edited repository state (`d:\build4manglore`) unless explicitly marked **NOT VERIFIED**.

---

## 1. Test & Build Execution Summary

| Suite / Check | Exact Command Executed | Result | Scope & Counts | Duration |
|---|---|---|---|---|
| **Monorepo TypeScript Typecheck** | `pnpm typecheck` | **PASS** | 3 packages (`@sentinel/shared`, `@sentinel/inbox-worker`, `@sentinel/web`), zero TS errors | 46.6s |
| **Shared Contracts & Crypto Unit Suite** | `pnpm --filter ./packages/shared test` | **PASS** | 1 file, **8/8 tests passed** (`units`, `AES-256-GCM PHI encryption`, `API keys`, `audit hash chain`) | 0.69s |
| **Cloudflare Inbox Worker Unit Suite** | `pnpm --filter ./workers/inbox test` | **PASS** | 1 file, **1/1 test passed** (RFC822 caregiver reply command extraction) | 0.29s |
| **Web Application & DB Vitest Suite** | `pnpm --filter ./apps/web test` | **PASS** | 13 test files, **46/46 tests passed** against real `embedded-postgres` (ports 5434–5441, RLS, partitions, triggers, ingestion, Web BLE `0x180D`/`0x1822`, Google Fit mocks, TS engine parity & synthetic timeline, caregiver direct check-in alerts/multi-device Web Push/Step 2 ntfy+push/overdue escalation/readiness, EN/KN/HI i18n, FHIR/cohort exports, OPD Scribe, CSP/security) | 88.23s |
| **Python Detection & Simulation Pytest** | `cd services/engine; uv run pytest -v` | **PASS** | 3 test files (`test_engine.py`, `test_health.py`, `test_sim.py`), **9/9 tests passed** | 65.09s |
| **Python Causal Benchmark + Ablations** | `uv run python -c "from engine.eval_harness import run_benchmark; ..."` | **PASS** | 11 synthetic scenarios x 2 seeds (`[42, 43]`) x 3 ablations (`Sensitivity 0.875`, `Specificity 1.000`, `PPV 1.000`, `0.000 false alerts/wk`) | ~25s |
| **Production Next.js Build** | `pnpm --filter ./apps/web build` | **PASS** | 61/61 app routes & middleware compiled cleanly with Turbopack + Next.js 16.4.6 | ~53s |
| **Playwright End-to-End + Axe WCAG 2.2 AA** | `$env:DATABASE_URL='postgres://sentinel:sentinel@127.0.0.1:5433/sentinel'; pnpm --filter ./apps/web test:e2e -- tests/e2e/phase4.spec.ts tests/e2e/phase7.spec.ts --reporter=list` | **PASS** | Full 8-spec suite (`phase1.spec.ts`–`phase8.spec.ts`, 3.4m) + post-fix reruns (`phase2.spec.ts` `1/1`, `phase4.spec.ts` + `phase7.spec.ts` `2/2 passed in 1.0m`) running against live Next.js + PostgreSQL | 1.0m / 3.4m |

---

## 2. Vitest File Breakdown (`apps/web/tests/unit`)

1. `ps2-verification.test.ts` — 6/6 passed (Google Fit Sleep Sessions `activityType=72` + `com.google.heart_rate.summary` + prioritized 24-stream `dataSources` + direct `/datasets` fallback + `403` error clarity; TS fallback `warming_prior -> learning -> calibrated` progression with all 4 PS2 metrics & Partial NEWS2; `excludedPeriods` quarantine & `exercise` exclusion; synthetic `Normal -> Drift -> First Detection -> Alert -> Recovery` lifecycle)
2. `watch-sync.test.ts` — 9/9 passed (Web BLE `0x2A37` RMSSD, `0x1822` PLX SpO2/PR SFLOAT, `acceptAllDevices` + `health_services` scan modes, adapter availability checks, GATT connect retry, `0x180A` identity & vendor diagnosis, Health Connect JSON, Apple Health Auto Export, Watch Webhook auth/idempotency, Open Wearables & Google Fit sync)
3. `ingestion-quality.test.ts` — 4/4 passed (Apple XML chunked unit conversion, CSV & Fitbit/Google Fit Takeout JSON, SHA-256 deduplication & motion artifact flagging, device silence monitor)
4. `engine-bridge.test.ts` — 1/1 passed (Evaluation & DB persistence into `baseline_states`, `risk_assessments`, `detector_decision_logs`)
5. `alerts-outbox.test.ts` — 4/4 passed (N-of-M, cooldown, quiet hours, bounded feedback, escalation steps `1->2->3`, transactional outbox receipts, `tap_unwell` / voice check-in direct caregiver alert dispatch, Step 2 `web_push`+`ntfy`, overdue escalation maintenance, readiness counts)
6. `db-rls-audit.test.ts` — 3/3 passed (`FORCE ROW LEVEL SECURITY` isolation + immutable `audit_logs` trigger + hash-chain integrity)
7. `auth-google.test.ts` — 4/4 passed (Better Auth Google OAuth PKCE & config safety)
8. `phase5-workflows.test.ts` — 1/1 passed (Dashboard queries, cohort RBAC, vitals series)
9. `phase6-i18n.test.ts` — 1/1 passed (EN / KN / HI dictionaries)
10. `phase7-channels.test.ts` — 3/3 passed (Multilingual voice triage parser, reply parser, RxNorm meds)
11. `opd-scribe.test.ts` — 5/5 passed (EN/KN/HI diarization, live clinical preview, SOAP/Rx/summary)
12. `phase8-exports.test.ts` — 3/3 passed (LOINC FHIR R4 Bundle & de-identified cohort pseudonymization)
13. `phase9-security.test.ts` — 2/2 passed (CSP headers, `no-store`, PHI encryption, audit tamper catch)

---

## 3. Items Explicitly **NOT VERIFIED** Live (External / Hardware Constraints)

- **Physical Bluetooth Smartwatches / Wear OS / Android Phones:** Live BLE `navigator.bluetooth` pairing and real Health Connect app delivery require physical mobile/watch hardware and were not executed.
- **Live Consumer Google Account -> Google Fit Cloud Data Pull:** Google Fit OAuth scopes (`fitness.heart_rate.read`, `fitness.activity.read`, `fitness.sleep.read`, `fitness.oxygen_saturation.read`) are restricted/sensitive Google OAuth scopes requiring interactive user consent in Google Cloud Console and live data synced to that Google account; only mocked Fit REST responses and OAuth state/token plumbing were verified automatically.
- **External Alert Gateways (Resend Email SMTP, Web Push VAPID Browser Delivery, Telegram Bot API, ntfy, Twilio SMS):** Policy & transactional `alert_deliveries` DB queueing ran end-to-end; actual third-party delivery over live credentials is unverified.
- **Public Dataset Archives (`PMData`, `LifeSnaps`, `WESAD`, `MMASH`):** Format adapters exist in `loaders.py`, but raw downloadable archives are not bundled in `_data/`.
- **Prospective Clinical Trial / Medical Accuracy:** SENTINEL is an early-awareness screening prototype validated on synthetic scenarios only.
