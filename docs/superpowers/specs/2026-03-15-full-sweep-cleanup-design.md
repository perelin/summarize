# Full Sweep: Remove Old Operating Model Remnants

**Date:** 2026-03-15
**Status:** Approved (blanket approval from user)
**Goal:** Remove all CLI, Chrome extension, and npm-library remnants; fold `packages/core` into `src/`; preserve all current web API + frontend functionality.

## Context

The project migrated from CLI + Chrome extension + npm library → web API + Preact frontend. Prior cleanup passes removed the CLI entry point, Chrome extension directory, daemon, TTY renderer, and npm publishing config. This is the second (final) pass to remove the remaining infrastructure that supported the old model.

## Scope

Six chunks, each followed by a full test run (`pnpm vitest run`).

### Chunk 1: CLI Transport Subsystem Removal

Remove the entire subsystem for routing LLM calls through local CLI tools (`claude`, `codex`, `gemini`, `agent`). This code is parsed, validated, plumbed through the stack, then hard-rejected at runtime.

**Types to remove:**

- `CliProvider`, `CliProviderConfig`, `CliAutoFallbackConfig`, `CliMagicAutoConfig`, `CliConfig` from `src/config/types.ts`
- `cli` transport variant from `FixedModelSpec` in `src/model-spec.ts`
- `"cli"` from `ModelAttempt.transport`, `ModelMeta.provider`, `LlmProvider` unions

**Functions/logic to remove:**

- `parseCliConfig()` in `src/config/sections.ts`
- `parseCliProviderList` in `src/config/parse-helpers.ts`
- `prependCliCandidates()`, `isCliProviderEnabled()`, `parseCliCandidate()`, CLI fallback resolution in `src/model-auto.ts`
- `DEFAULT_CLI_MODELS`, `DEFAULT_AUTO_CLI_ORDER`, `parseCliProviderName()`, `requiredEnvForCliProvider()` in `src/llm/provider-capabilities.ts`
- CLI guards in `src/run/summary-engine.ts`, `src/run/streaming.ts`, `src/summarize/chat.ts`
- `cliFlagPresent`/`cliProviderArg` parameters from `src/run/run-config.ts`, `src/run/run-context.ts`
- `cliAvailability` from `src/run/run-env.ts`
- `parseCliProviderArg()`, `parseCliUserModelId()` from `src/run/env.ts`
- `applyAutoCliFallbackOverrides()` in `src/summarize/flow-context.ts`
- `cliClaude`, `cliGemini`, `cliCodex`, `cliAgent` from `src/summarize/models.ts`
- `configForCli`, `cliConfigForRun` from `src/run/run-config.ts`
- CLI model ID parsing from `src/model-spec.ts`

**Config to remove:**

- `ui.theme` parsing and type (TTY renderer deleted)
- `cli` section parsing from `parseCliConfig()`
- `SummarizeConfig.cli` and `SummarizeConfig.ui.theme` fields

**Backward-compat shims to remove:**

- `magicCliAuto`, `magicCliOrder`, `magicCliRememberLastSuccess` from `RunOverridesInput` in `src/run/run-settings.ts`
- `autoCliFallbackEnabled`, `autoCliOrder`, `autoCliRememberLastSuccess` from `RunOverrides`

### Chunk 2: Dead Code Removal

- Delete `src/bun-sqlite.d.ts` (Bun type shim, project runs Node.js)
- Remove dead exports from `src/flags.ts`: `parseExtractFormat()`, `parseStreamMode()`, `parseMetricsMode()`, `parseMaxExtractCharactersArg()` (types they define stay if used)
- Remove `resolveCliRunSettings()` and `ResolvedRunSettings` from `src/run/run-settings.ts`
- Remove `buildPathSummaryPrompt` from `packages/core/src/prompts/cli.ts` (or delete file)
- Remove CLI user tips: `withUvxTip` from `src/run/tips.ts`, `BIRD_TIP`/`TWITTER_TOOL_TIP` from `src/run/constants.ts`
- Remove `isTTY = false` workaround from `src/summarize/flow-context.ts`

### Chunk 3: Naming Cleanup

- Rename `VisiblePageInput` → `TextInput` in `src/summarize/pipeline.ts`
- Rename `streamSummaryForVisiblePage` → `streamSummaryForText` in `src/summarize/pipeline.ts`
- Rename `VisiblePageMetrics` → `TextSummaryMetrics`
- Update all call sites in `src/server/routes/summarize.ts`

### Chunk 4: Docs & Assets Cleanup

**Delete (stale CLI/extension docs):**

- `docs/extract-only.md`, `docs/website.md`, `docs/llm.md`, `docs/openai.md`, `docs/model-auto.md`, `docs/model-provider-resolution.md`
- `docs/README.md`, `docs/index.md` (Jekyll site references)
- `docs/config.md` (documents `ui.theme` and CLI flags)
- `docs/assets/summarize-cli.png`, `docs/assets/summarize-extension.png`
- `docs/assets/site.css`, `docs/assets/site.js`

**Delete (historical planning docs that reference deleted code):**

- `docs/superpowers/plans/2025-03-11-pipeline-timing.md`
- `docs/superpowers/plans/2025-03-11-structured-insights.md`
- `docs/superpowers/specs/2025-03-11-pipeline-timing-design.md`
- `docs/superpowers/plans/2026-03-13-deprecate-extension-migrate-web.md`
- `docs/superpowers/plans/2026-03-13-milestone-chunks-1-3-complete.md`
- `docs/superpowers/specs/2026-03-13-deprecate-extension-migrate-web-design.md`

**Keep (still-relevant docs):**

- `docs/api-server.md` — current API reference
- `docs/deployment.md` — production deployment runbook
- `docs/youtube.md`, `docs/slides.md`, `docs/media.md`, `docs/firecrawl.md`, `docs/language.md`, `docs/cache.md` — feature docs (update to remove CLI flag examples, frame as API params)
- `docs/nvidia-onnx-transcription.md`, `docs/transcript-provider-flow.md`, `docs/timestamps.md` — transcription docs
- `docs/manual-tests.md`, `docs/smoketest.md` — testing guides
- `docs/slides-rendering-flow.md` — architecture doc
- Recent planning docs that reference current code

**Update "Daemon note:" → "API note:"** in `docs/website.md` (if kept) and `docs/extract-only.md` (if kept).

### Chunk 5: Fold `packages/core` into `src/`

Move `packages/core/src/*` → `src/core/`:

- `src/core/content/` — URL content extraction, link-preview, transcript
- `src/core/prompts/` — system prompts, length configs
- `src/core/transcription/` — Whisper, cloud providers, ONNX
- `src/core/summarize/` — pipeline metadata, progress
- `src/core/shared/` — format, SSE events, contracts
- `src/core/openai/` — base-url
- `src/core/index.ts`, `src/core/language.ts`, `src/core/processes.ts`

**Import updates:** ~25 src files + ~5 test files change from `@steipete/summarize_p2-core` → relative paths to `src/core/`.

**Dependency migration:** Move core's dependencies to root `package.json`:

- `@fal-ai/client`, `@mozilla/readability`, `cheerio`, `es-toolkit`, `jsdom`, `sanitize-html`
- Move core's devDependencies: `@types/jsdom`, `@types/sanitize-html`

**Remove:**

- `packages/core/` directory entirely
- `packages/core` from pnpm workspace config
- `@steipete/summarize_p2-core` from root dependencies
- CI "Pack (core)" step

**Update:**

- Root `package.json` scripts (remove `build:core` step or adjust)
- `tsconfig` references
- Build scripts

### Chunk 6: Final Cleanup

- Remove `"DOM"` from `tsconfig.base.json` `lib` array
- Delete `.npmrc` (empty file)
- Remove/update tests that test deleted code (`tests/run.env.test.ts` CLI parts, `tests/model-auto.test.ts` CLI parts, `tests/config.test.ts` CLI parts, `tests/prompts.cli.test.ts`)
- Update `vitest.config.ts` coverage thresholds
- Clean up the worktree at `.worktrees/deprecate-extension/` if it exists on main
- Final full test run + build verification

## Risk Mitigation

- **Test after every chunk** — `pnpm vitest run` catches regressions immediately
- **Build after chunks 5-6** — `pnpm build` verifies the structural changes compile
- **Chunk order matters** — CLI removal (1-2) is safe because all paths are guarded. Naming (3) is a rename-only refactor. Docs (4) can't break code. Core folding (5) is the riskiest — do it after everything else so test baseline is clean.

## What We're NOT Changing

- API endpoints and their behavior
- SSE streaming protocol
- Transcription pipeline
- LLM provider integrations (OpenAI, Anthropic, Google, etc.)
- OpenRouter support
- Web frontend (apps/web)
- Database/history/cache
- Authentication/multi-account
- Slides pipeline
- Deployment workflow
