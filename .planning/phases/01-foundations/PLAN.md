# Phase 1 Plan: Foundations

- **Phase:** 1 of 9
- **Requirements Covered:** `REQ-AUTH-01`, `REQ-AUTH-02`, `REQ-SEC-01`, `REQ-SEC-02`, `REQ-SEC-03` (foundation), `REQ-UI-04` (tokens)
- **Brand Identity (`DEC-005`):** **Sachet · SENTINEL** (packages `@sentinel/*`)

## Tasks
1. **Monorepo & Python Workspace:** Root `pnpm-workspace.yaml`, `turbo.json`, `package.json`, `tsconfig.base.json`, `packages/shared`, `apps/web`, `services/engine`, `workers/inbox`, `.env.example`, `.github/workflows/ci.yml`, `docker-compose.yml`.
2. **Design System (`DESIGN.md`):** Open Design schema + `ui-ux-pro-max-skill` grounded typography (`Fraunces` display + `Atkinson Hyperlegible` + `Noto Sans Kannada`/`Devanagari` + `JetBrains Mono`) and WCAG 2.2 AA light/dark tokens (`DESIGN.md` + CSS variables).
3. **Database, RLS & Audit Chain:** Drizzle schema + raw SQL migration (`0001_init.sql`) creating partitioned `vital_samples`, hourly/daily rollups, `patient_profiles` (encrypted PII), `consent_grants`, `care_circle_members`, `api_keys`, `baseline_states`, `risk_assessments`, `detector_decision_logs`, `alerts`, `alert_deliveries` outbox, and immutable hash-chained `audit_logs`, plus Postgres RLS policies and `embedded-postgres` local zero-Docker runner + deterministic seed script.
4. **Auth, RBAC & Consent Endpoints (`apps/web`):** Better Auth session & RBAC middleware (`src/proxy.ts` with strict CSP headers), `/api/health`, `/api/v1/consent` (grant/withdraw + audit chain), `/api/v1/care-circle` (invite/accept), and `services/engine` FastAPI `/healthz` + `/readyz` skeleton.
5. **Phase 1 UI & Verification:** Sign-in/sign-up, Role & Consent ledger dashboard, Light/Dark accessible token showcase, Vitest unit/DB/audit tests, pytest contract test, and Playwright + `@axe-core/playwright` capture to `docs/evidence/phase-1/`.
