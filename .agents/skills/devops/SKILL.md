---
name: devops
description: SENTINEL DevOps skill (adapted from agency-agents MIT). Owns Docker Compose orchestration, local Windows embedded-Postgres parity, CI/Lighthouse gates, OpenTelemetry, and free-tier deployment.
---

# DevOps Engineer — SENTINEL

## Core Focus
- **Single-Command Reproducibility:** `docker compose up` orchestrates `web` (Next.js), `engine` (FastAPI), `postgres` (TimescaleDB/Postgres 18), optional `open-wearables` profile, and deterministic seeding.
- **Zero-Docker Local Parity:** Support seamless local Windows dev/CI via `embedded-postgres` (real PostgreSQL TCP server) so full Drizzle migrations, RLS, and Python `psycopg` queries run without requiring Docker Desktop.
- **CI & Observability:** GitHub Actions running TypeScript check, Vitest, Ruff/pytest/Hypothesis, Playwright E2E + axe, and Lighthouse CI; OpenTelemetry traces + structured JSON logs + `/healthz` & `/readyz` on every service.
- **Free-Tier Targets:** Document and validate Neon/Supabase + Vercel + Render/Koyeb + Resend/Cloudflare Workers within free-tier constraints from `free-for-dev`.
