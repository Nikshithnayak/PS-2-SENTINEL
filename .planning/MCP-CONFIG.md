# MCP Server Budget & Configuration (Max 8)

To protect agent context and adhere to Section 3 limits, SENTINEL uses **at most 8 MCP servers**.

| # | MCP Server | Role in SENTINEL Workflow | Status in Current Environment |
|---|---|---|---|
| 1 | `chrome-devtools-mcp` / Playwright | Real browser testing, DOM/a11y verification, screenshot capture to `docs/evidence/` | **Active** (`chrome-devtools-mcp` configured + local `@playwright/test` Chromium) |
| 2 | `GitKraken` (GitHub / Git) | Repo inspection, commit history, PRs, branches | **Active** (`GitKraken` MCP configured + local `git`) |
| 3 | `perplexity-ask` / Web Search | Late-2026 library/API fact checking & clinical literature retrieval | **Active** (`perplexity-ask` MCP + `search_web`) |
| 4 | `Context7` | Version-pinned live library docs (Next.js 16, Drizzle 0.45, Better Auth, ECharts, FastAPI) | **Optional External** — add `npx -y @upstash/context7-mcp` if desired |
| 5 | `21st-dev/magic` (`/ui`) | Interactive UI prototyping & refinement aligned to `DESIGN.md` tokens | **Optional External** — requires free API key from `21st.dev/mcp` (see `docs/SETUP-NEEDED.md`) |
| 6 | `postgres` (Postgres Inspector) | Read-only schema/index inspection against `DATABASE_URL` | **Optional External** — `@modelcontextprotocol/server-postgres` using `DATABASE_URL` |
| 7 | `sequential-thinking` | Structured multi-step clinical/statistical failure analysis | **Optional External** — `@modelcontextprotocol/server-sequential-thinking` |
| 8 | `open-wearables` | FastMCP server exposing standardized wearable queries when `open-wearables` Docker profile runs | **Optional Local** — runs via `uv run start` in `_refs/open-wearables/mcp` (see `docs/SETUP-NEEDED.md`) |

> **Hard Cap Enforced:** 8 total slots (3 active natively, 5 optional plug-ins documented without bloating context).
