# Summarize Guardrails

- Hard rule: single source of truth = `~/Projects/summarize`; never commit in `vendor/summarize` (treat it as a read-only checkout).
- Note: multiple agents often work in this folder. If you see files/changes you do not recognize, ignore them and list them at the end.

## Workspace layout (note)

- Monorepo (pnpm workspace). Root package is private (not published to npm).
- Packages:
  - `@steipete/summarize-web` (`apps/web`) = Preact + Vite frontend. Builds to static assets served by the API server.
- Core library code lives in `src/core/` (no separate package).
- Dev:
  - Build: `pnpm -s build` (builds web frontend, then lib)
  - Gate: `pnpm -s check`
  - Deploy: `task deploy` (bumps version, runs checks, creates GitHub Release → triggers deploy Action)
- Local dev (two terminals):
  1. `pnpm server:dev` — API server on port 3000 (tsx watch, auto-restarts on changes)
  2. `cd apps/web && npx vite --host --port 5173` — Vite frontend with LAN access, proxies `/v1` to API
  - Open `http://localhost:5173` (or `http://<lan-ip>:5173` from other devices)
  - Requires `config.json` in project root (gitignored) with accounts. Include an `"anonymous"` account for the web UI to auto-authenticate:
    ```json
    {
      "accounts": [
        { "name": "you", "token": "<token-a>" },
        { "name": "anonymous", "token": "<different-token-b>" }
      ]
    }
    ```
  - Requires `.env` with LLM provider API keys
  - First run: `mkdir -p src/server/public` (needed for tsx watch path)
- Web frontend:
  - Dev: `pnpm -C apps/web dev` (Vite on port 5173, localhost only, proxies `/v1` to API on port 3000)
  - Build: `pnpm -C apps/web build` (outputs to `apps/web/dist/`, copied to `dist/esm/server/public/` during `build:lib`)
- API server: `node dist/esm/server/main.js` (requires `accounts` config in `config.json` or `$SUMMARIZE_DATA_DIR/config.json`). See `docs/api-server.md`.
  - Server tests: `pnpm vitest run tests/server.*.test.ts`
  - Endpoints: `/v1/summarize` (POST JSON or SSE), `/v1/history`, `/v1/chat`, `/v1/summarize/:id/slides`, `/v1/slides/:sourceId/:index`, `/v1/me`
- Commits: Conventional Commits (`type: message`).
