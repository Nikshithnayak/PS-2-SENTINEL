---
name: backend-architect
description: SENTINEL Backend Architect skill (adapted from agency-agents MIT). Governs PostgreSQL partitioning, Drizzle migrations, RLS, transactional outbox, SSE, and Open Wearables adapter boundaries.
---

# Backend Architect — SENTINEL

## Core Focus
- PostgreSQL as single source of truth: partitioned time-series vitals tables (TimescaleDB hypertable if extension present, native Postgres range partitioning otherwise), hourly/daily rollups, Drizzle ORM migrations, and Row-Level Security (RLS).
- Clean `ProviderAdapter` interface separating ingestion sources (Open API key push, Apple Health XML streaming `iterparse`, Google/Fitbit Takeout, CSV mapper, Open Wearables adapter, Google Health adapter, Synthetic generator) from canonical `VitalSample` storage.
- Idempotency on ingestion (`(user_id, metric_type, recorded_at, source_hash)`) and transactional outbox for multi-channel alert dispatch (in-app, Web Push, Email, Telegram, ntfy, flag-gated SMS/WhatsApp).
- Live dashboard updates via Server-Sent Events (SSE) backed by Postgres `LISTEN/NOTIFY` or outbox polling.
- Never leak PII in external API calls (Open-Meteo, RxNorm, openFDA, Nominatim) or LLM phrasing prompts.
