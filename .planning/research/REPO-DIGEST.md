# Repository Digest — SENTINEL Phase 0

> **Phase 0 Deliverable (Step 1)** · Every entry below was verified by shallow-cloning into `_refs/` (gitignored) and inspecting `README.md`, `LICENSE*`, manifests (`package.json` / `pyproject.toml`), and source structure as of **November 25, 2026**.  
> **Rule:** Prefer installing published packages over copying code, strictly respect licenses, and list all attributions in [CREDITS.md](../../CREDITS.md).

---

## Summary Matrix

| # | Repository | Verified License | Role | Integration Point in SENTINEL | Key Risk / Constraint |
|---|---|---|---|---|---|
| 1 | `the-momentum/open-wearables` | MIT | **CORE** | Optional ingestion service in `docker-compose.yml` + schema inspiration for `ProviderAdapter` & Apple Health XML streaming parser | Full stack requires Redis + Celery + Postgres + Svix; legacy Fitbit provider inside is deprecated (Nov 2026 shutdown) |
| 2 | `cloudflare/agentic-inbox` | Apache-2.0 | **CORE** | `workers/inbox` Cloudflare Worker + Inbound Email Routing pattern (`OK`, `CALL ME`, `SNOOZE` caregiver replies) | Requires Cloudflare domain + Email Routing in prod; provide signed local webhook emulator for dev/CI |
| 3 | `Open-LLM-VTuber/Open-LLM-VTuber` | MIT (`LICENSE-Live2D.md` separate) | **CORE (Pattern)** | Reference for Phase 7 elder voice check-in pipeline (VAD -> ASR -> deterministic symptom parser -> TTS + barge-in) | Live2D models under separate proprietary Live2D license (**never** bundle Live2D); build clean Web Audio/WebSocket check-in instead |
| 4 | `public-apis/public-apis` | MIT | **CORE (Catalog)** | Verified free external context APIs: **Open-Meteo** (heat/AQI), **RxNorm** (medication normalization), **openFDA**, **Nominatim / Overpass** (nearest hospital) | **Strict PHI boundary:** never send user IDs, names, or wearable telemetry; round coordinates or use district/city centroid only |
| 5 | `ripienaar/free-for-dev` | CC0 / Public Repo | **INFRA** | Free-tier cloud hosting/DB/monitoring shortlist (Neon/Supabase Postgres, Vercel, Render/Koyeb, Resend/Brevo, Sentry/GlitchTip, Axiom) | Cold-start sleep on Render/Koyeb free tiers; Neon 0.5 GB / 100 CU-hr limits; document keep-alive & storage caps |
| 6 | `nextlevelbuilder/ui-ux-pro-max-skill` | MIT | **DESIGN** | Executed `scripts/search.py` to generate healthcare design direction (Atkinson Hyperlegible, calm clinical teal/emerald/crimson palette, WCAG 2.2 AA rules) | Script flagged `Neumorphism` as high accessibility risk — override to high-contrast crisp clinical surfaces |
| 7 | `nexu-io/open-design` | Apache-2.0 | **DESIGN** | Defines portable `DESIGN.md` format (H1 + blockquote pitch + numbered sections + token contract) and `design-review` verification discipline | Large daemon workspace — extract only the `DESIGN.md` convention and review checklist, do not install daemon |
| 8 | `21st-dev/magic-mcp` | ISC | **DESIGN** | Reference / MCP UI generation pattern (`/ui` flow) for landing hero & dashboard primitives, then aligned to SENTINEL tokens | Repo notes Magic MCP is superseded by `@21st-dev/cli` HTTP MCP (`21st.dev/api/mcp`) needing an API key; optional external MCP |
| 9 | `motiondivision/motion` | MIT | **DESIGN** | Install `motion` (`14.14.0`) npm package for UI transitions, alert entrances, numeric tickers, and `useReducedMotion()` support | Must wrap layout animations with `<MotionConfig reducedMotion="user">` for vestibular/elder accessibility |
| 10 | `ruucm/shadergradient` | MIT | **DESIGN** | Install `@shadergradient/react` (`2.4.24`) npm package for subtle landing hero backdrop & Patient Today calm status aura | Requires Three.js / React Three Fiber peer deps; isolate behind lazy client boundary, 1 WebGL context/page, static fallback |
| 11 | `paper-design/liquid-logo` | **PolyForm Shield 1.0.0** | **SKIP (Code)** / **Package Only** | **Do NOT copy repo code** (PolyForm Shield has non-compete terms). Install `@paper-design/shaders-react` (`0.0.82`, **Apache-2.0**) or craft clean SVG/shader brand mark | PolyForm Shield 1.0.0 restricts competing offerings on the demo app code; published `@paper-design/shaders-react` package is Apache-2.0 |
| 12 | `dashersw/liquid-glass-js` | MIT | **DESIGN (Pattern)** | CSS + lightweight WebGL refraction reference for floating nav/sheets/toasts ONLY (never behind dense charts/tables) | Demo uses `html2canvas` which adds heavy DOM snapshots; prefer crisp CSS `backdrop-filter` + optional lightweight WebGL chrome |
| 13 | `pmndrs/react-three-fiber` | MIT | **DESIGN** | Install `@react-three/fiber` (`9.x` for React 19) + `three` for landing-page-only 3D physiological pulse/waveform & ShaderGradient host | Must match React 19 (`@react-three/fiber@9`), lazy-load client-only, pause off-screen (`frameloop="demand"` or IntersectionObserver) |
| 14 | `garrytan/gstack` | MIT | **INFRA (Process)** | Adapted `office-hours`, `plan-ceo-review`, `plan-eng-review`, and `DESIGN.md` YAML frontmatter spec into `.agents/workflows/` | Shell scripts target macOS/Linux `~/.claude/skills/gstack` + Bun; adapt workflow methodology directly as markdown specs |
| 15 | `rmyndharis/antigravity-skills` | MIT | **INFRA (Skills)** | Source for `ml-engineer`, `backend-security-coder`, `architecture-decision-records`, `c4-architecture` distilled into `.agents/skills/` | 300+ skills bloat context — install strictly within the 10-skill cap |
| 16 | `msitarzewski/agency-agents` | MIT | **INFRA (Skills)** | Source for `product-manager`, `design-ux-researcher`, `engineering-backend-architect`, `testing-reality-checker`, `engineering-devops-automator`, `engineering-technical-writer` | Install tailored excerpts into `.agents/skills/` within 10-skill cap |
| 17 | `Pythoughts-labs/react-frontend-skills` | MIT | **INFRA (Skills)** | Source for Next.js 16 App Router rules (`proxy.ts`, `use cache`, Server Components) & React 19 / Playwright / Vitest conventions | Align strictly to Next.js 16.4 (`proxy.ts` instead of legacy `middleware.ts`) |
| 18 | `punkpeye/awesome-mcp-servers` | MIT | **REFERENCE** | Curated catalog used to verify official Context7, Postgres, Sequential Thinking, Fetch, and Playwright MCP server choices | Documentation index only; cap active MCP servers at <= 8 |
| 19 | `greatfrontend/awesome-front-end-system-design` | MIT | **REFERENCE** | RADIO framework checklist guiding `docs/ARCHITECTURE.md` frontend architecture section (rendering, state, SSE, caching, a11y, errors) | Curated link index only |
| 20 | `Anil-matcha/Open-Generative-AI` | MIT | **SKIP** | Evaluated for decorative onboarding media; **marked SKIP** because it is a heavy multi-workspace video generation studio with external paid/uncensored model wrappers | Does not earn its place; clean clinical SVGs / Lucide icons + procedural canvas/shader visuals are faster, safer, and zero-PII |
| 21 | `medplum/medplum` | Apache-2.0 | **CORE (Types)** | Install `@medplum/fhirtypes` (`5.2.18`) npm package in `packages/shared` & `apps/web` for strict FHIR R4 `Patient`, `Observation`, `Flag` JSON export | Install ONLY `@medplum/fhirtypes` (types package), not full Medplum clinical server |

---

## Additional Verified Core Packages (Section 3 & Section 8)

| Package / Tool | Verified License | Latest Version (Nov 2026) | Integration Point |
|---|---|---|---|
| `next` / `react` / `tailwindcss` | MIT | `next@16.4.6`, `tailwindcss@4.x` | `apps/web` App Router PWA frontend (`proxy.ts`, Turbopack, React 19) |
| `drizzle-orm` | Apache-2.0 | `0.45.4` | Typed PostgreSQL migrations, partitioned vitals tables, RLS-aware queries |
| `better-auth` | MIT | `1.7.28` | Self-hosted auth, sessions, RBAC (`patient`, `caregiver`, `clinician`, `org_admin`) |
| `echarts` | Apache-2.0 | `6.1.0` | Zoomable clinician signal charts with baseline bands, change-points, alert/med overlays + keyboard/table fallback |
| `embedded-postgres` | MIT | `19.0.0-beta.20` (or stable v18) | Local zero-Docker fallback PostgreSQL TCP server on Windows dev/CI alongside Docker Compose `postgres` |
| `fastapi` / `uvicorn` | MIT / BSD-3 | `fastapi@0.165.0`, `uvicorn@0.54.0` | `services/engine` Python 3.12 REST API & health/readiness endpoints |
| `ruptures` | BSD-2-Clause | `1.1.10` | L2 offline/windowed change-point detection (PELT / Binseg) for physiological shifts |
| `river` | BSD-3-Clause | `0.27.0` | L3 streaming `HalfSpaceTrees` multivariate anomaly scoring + incremental drift stats |
| `neurokit2` | MIT | `0.3.0` | Physiological signal quality, IBI/HRV cleaning, and PPG/respiratory helpers |
| `scikit-learn` | BSD-3-Clause | `1.9.1` | L3 `IsolationForest`, `MinCovDet` (robust Mahalanobis covariance), evaluation metrics |
| `hypothesis` / `pytest` | MPL-2.0 / MIT | `hypothesis@6.170.17`, `pytest@9.2.0` | Property-based invariants (no NaN, bounded [0,100], baseline quarantine) & golden scenario suite |
| `@playwright/test` / `@axe-core/playwright` | Apache-2.0 / MPL-2.0 | `@playwright/test@1.58+` | Real browser verification + WCAG 2.2 AA accessibility audit + `docs/evidence/` screenshots |

---

## Detailed Repo Evaluations & Integration Notes

### 1. `the-momentum/open-wearables` (MIT — CORE)
- **What it really is:** Full self-hosted platform (FastAPI + PostgreSQL + Redis + Celery + Svix + SvelteKit portal + FastMCP server) supporting cloud OAuth providers (Garmin, Oura, Whoop, Polar, Suunto, Strava, Withings, Ultrahuman, SensorBio, Google Health) and on-device mobile SDK uploads (Apple HealthKit, Google Health Connect, Samsung Health), plus streaming Apple Health `export.xml` import (`backend/app/services/providers/apple/apple_xml/xml_service.py`) and 100+ unified `SeriesType` enum metrics (`backend/app/schemas/enums/series_types.py`).
- **Integration in SENTINEL:**
  - Define our own clean `ProviderAdapter` TypeScript/Python interface in SENTINEL so SENTINEL never couples directly to Open Wearables internals.
  - Provide an `OpenWearablesAdapter` calling Open Wearables REST/webhook endpoints (`GET /timeseries`, `/sleep`, `/activity`) AND include `open-wearables` as an optional profile in `docker-compose.yml`.
  - Mirror its verified unit-conversion and streaming `iterparse` XML safety principles in SENTINEL's direct Apple Health `export.xml` importer (handling HealthKit `%` 0–1 vs 0–100 conversion, invalid decimal guards, and streaming memory bounds).
  - **Crucial deprecation verification:** `_refs/open-wearables/README.md` marks Fitbit as `(deprecated)` and includes `google_health_endpoints.py` (`/v4/users/me/dataTypes/{data_type}/dataPoints`), confirming the Sept–Nov 2026 Fitbit Web API shutdown and migration to Google Health API.

### 2. `cloudflare/agentic-inbox` (Apache-2.0 — CORE)
- **What it really is:** Cloudflare Workers + Hono + Durable Objects (SQLite migrations) + R2 attachments + Cloudflare Email Routing handler (`workers/email-sender.ts`, `workers/routes/reply-forward.ts`, `In-Reply-To` / `References` threading headers).
- **Integration in SENTINEL:**
  - Implement `workers/inbox` using this exact pattern for two-way caregiver alert emails: outgoing alerts include a signed reply-to token (`alert+<incident_id>.<hmac>@...`) and `Message-ID`; caregiver email replies (`OK`, `ACK`, `CALL ME`, `SNOOZE 2H`, `FALSE ALARM`) parse deterministically first (regex + keyword parser, optional LLM normalization for free-text notes) and call SENTINEL's authenticated webhook endpoint to update escalation state in Postgres.
  - Because live Cloudflare Email Routing requires a verified domain, include a local HTTP email-reply simulator endpoint & test harness in dev/CI.

### 3. `Open-LLM-VTuber/Open-LLM-VTuber` (MIT — CORE Pattern)
- **What it really is:** Python FastAPI + WebSocket voice assistant orchestrating Silero VAD, ASR (Whisper/SenseVoice/Sherpa), LLM agent, TTS (edge-tts/ElevenLabs/Piper), and real-time client barge-in interruption (`websocket_handler.py`, `conversation_handler.py`).
- **Integration in SENTINEL:**
  - **Do NOT install Live2D models (`LICENSE-Live2D.md` has separate proprietary terms)** and do not bundle heavy PyTorch/GPU desktop models inside the core web container.
  - Adopt its clean WebSocket / state-machine pattern (`idle -> listening -> transcribing -> responding -> interrupted`) for SENTINEL's Phase 7 Elder Voice Check-In: browser Web Audio capture + Web Speech / pluggable ASR/TTS (with deterministic tap fallback in English, Kannada, Hindi + `edge-tts` or browser SpeechSynthesis), plus an optional WebSocket bridge config if a user runs a local Open-LLM-VTuber server.

### 4. `public-apis/public-apis` (MIT — CORE Context Catalog)
- **Verified Free APIs Used in SENTINEL:**
  - **Open-Meteo** (`api.open-meteo.com/v1/forecast` & `air-quality-api.open-meteo.com/v1/air-quality`): No API key required, HTTPS + CORS enabled — fetches ambient temperature, apparent heat index, humidity, and PM2.5/AQI for dehydration/heat stress and COPD confounding.
  - **RxNorm** (`rxnav.nlm.nih.gov/REST/`): No API key required, HTTPS + CORS enabled — normalizes medication names (e.g., Metoprolol, Furosemide, Salbutamol) to RxCUIs for clinician/medication overlays.
  - **openFDA** (`api.fda.gov/drug/label.json`): Public drug label lookups (rate-limited without key, higher quota with optional key) for drug safety/side-effect context (e.g., beta-blockers lowering baseline HR).
  - **Nominatim + Overpass / OpenStreetMap**: Geocoding & nearest emergency clinic/hospital lookup for the Urgent escalation emergency card.
  - **Privacy Rule:** All outbound calls strip user identifiers and truncate/snap coordinates to ~5 km city/ward level except explicit emergency nearest-hospital lookup triggered on-device/by user.

### 5. `garrytan/gstack`, `msitarzewski/agency-agents`, `rmyndharis/antigravity-skills`, `Pythoughts-labs/react-frontend-skills` (MIT — INFRA)
- Adapted into `.agents/workflows/` (`office-hours.md`, `ceo-review.md`, `eng-review.md`) and 10 focused role skills under `.agents/skills/`.
- Note: `Pythoughts-labs/react-frontend-skills` explicitly documents **Next.js 16.4** conventions (`proxy.ts` network boundary instead of deprecated `middleware.ts`, `use cache` directive, Server Component streaming).

### 6. Visual Stack (`ui-ux-pro-max-skill`, `open-design`, `motion`, `shadergradient`, `react-three-fiber`, `liquid-glass-js`, `liquid-logo`, `21st-dev/magic-mcp`)
- `ui-ux-pro-max-skill` ran locally via Python and surfaced **Atkinson Hyperlegible** + clinical cyan/emerald/crimson palette + strict contrast/reduced-motion/no-emoji-icon rules.
- `open-design` + `gstack/DESIGN.md` provide the portable `DESIGN.md` contract (YAML token frontmatter + numbered visual architecture sections).
- `liquid-logo` repo code is excluded due to **PolyForm Shield 1.0.0** non-compete terms; we only use OSI-licensed npm dependencies (`motion`, `@shadergradient/react`, `@react-three/fiber`, `@paper-design/shaders-react` Apache-2.0 if needed, or custom accessible SVG/WebGL mark).
