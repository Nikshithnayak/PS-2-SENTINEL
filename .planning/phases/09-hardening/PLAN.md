# Phase 9 Plan — Hardening, Load Testing, Architecture Docs & Final Delivery

## Objectives
1. **UI & E2E Polish:**
   - Replace literal backticks in `apps/web/src/app/model-card/page.tsx` with clean semantic `<code>` spans.
   - Ensure `phase8.spec.ts` awaits `Ramesh Pai` hydration before saving `clinician-report-desktop.png`.
2. **Load & Latency Verification (`scripts/load-test.k6.js` + `scripts/load-test.mjs`):**
   - Provide standard k6 load script (`scripts/load-test.k6.js`) AND zero-external-binary Node HTTP concurrent load driver (`scripts/load-test.mjs`) testing `/api/health`, `/api/v1/ingest` (batch vitals with idempotency), and `/api/v1/dashboard/patient`, recording real measured p50/p95 latency & error rate directly in Phase 9 verification!
3. **Security & OWASP ASVS / DPDP Hardening Tests (`apps/web/tests/unit/phase9-security.test.ts`):**
   - Verify CSP / X-Frame-Options / nosniff headers in `src/proxy.ts`, PHI encryption round-trip without plaintext leaks, audit hash-chain verification (`verifyAuditChain`), RBAC/scope denials (`401`/`403`) across patient/caregiver/unlinked accounts, and synthetic/non-synthetic data separation.
4. **Honest Documentation Suite (`technical-writer` + `backend-architect` + `devops`):**
   - `README.md`: crisp quickstart, zero-Docker `pnpm dev` / `embedded-postgres` + Python engine instructions, Docker Compose path, architecture overview, and links to docs.
   - `docs/ARCHITECTURE.md`: Mermaid C4 system & container diagrams, PostgreSQL partitioned schema & RLS summary, alerting/outbox sequence diagram, STRIDE threat model, RADIO frontend architecture (`greatfrontend` checklist), and hosting/free-tier ADR.
   - `docs/PITCH.md`: 3-minute hackathon demonstration script tied 1:1 to live screens, seeded accounts, and measured ablation numbers.
5. **Final Clean Full Regression:**
   - Run EVERY test suite after final edit (`pnpm typecheck`, `@sentinel/shared test`, `@sentinel/inbox-worker test`, `@sentinel/web test`, `services/engine` `uv run pytest -v`, `pnpm --filter @sentinel/web build`, `pnpm --filter @sentinel/web test:e2e`, plus live Node load probe) -> capture `docs/evidence/phase-9/` -> write `.planning/phases/09-hardening/VERIFICATION.md` -> final atomic commit!
