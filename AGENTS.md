# Summarize Guardrails

- Hard rule: single source of truth = `~/Projects/summarize`; never commit in `vendor/summarize` (treat it as a read-only checkout).
- Note: multiple agents often work in this folder. If you see files/changes you do not recognize, ignore them and list them at the end.

## Workspace layout (note)

- Monorepo (pnpm workspace).
- Packages:
  - `@steipete/summarize` = CLI + UX (TTY/progress/streaming). Depends on core.
  - `@steipete/summarize-core` (`packages/core`) = library surface for programmatic use (Sweetistics etc). No CLI entrypoints.
  - `@steipete/summarize-web` (`apps/web`) = Preact + Vite frontend. Builds to static assets served by the API server.
- Versioning: lockstep versions; publish order: core first, then CLI (`scripts/release.sh` / `RELEASING.md`).
- Dev:
  - Build: `pnpm -s build` (builds core, then web frontend, then lib, then CLI)
  - Gate: `pnpm -s check`
  - Import from apps: prefer `@steipete/summarize-core` to avoid pulling CLI-only deps.
- Web frontend:
  - Dev: `pnpm -C apps/web dev` (Vite on port 5173, proxies `/v1` to API on port 3000)
  - Build: `pnpm -C apps/web build` (outputs to `apps/web/dist/`, copied to `dist/esm/server/public/` during `build:lib`)
- API server: `node dist/esm/server/main.js` (requires `accounts` config in `~/.summarize/config.json`). See `docs/api-server.md`.
  - Server tests: `pnpm vitest run tests/server.*.test.ts`
  - Endpoints: `/v1/summarize` (POST JSON or SSE), `/v1/history`, `/v1/chat`, `/v1/summarize/:id/slides`, `/v1/slides/:sourceId/:index`, `/v1/me`
- Commits: use `committer "type: message" <files...>` (Conventional Commits).
