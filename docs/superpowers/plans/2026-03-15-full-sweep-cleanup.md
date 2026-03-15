# Full Sweep Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all CLI transport, Chrome extension, and npm-library remnants from the codebase; fold `packages/core` into `src/core/`; preserve all web API + frontend functionality.

**Architecture:** Six sequential chunks. Each chunk followed by `pnpm vitest run` to catch regressions. Chunks 1-4 remove dead code/config/docs. Chunk 5 restructures the monorepo. Chunk 6 is final cleanup.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Hono

---

## Chunk 1: CLI Transport Subsystem Removal

Remove the entire subsystem for routing LLM calls through local CLI tools. This code is parsed, validated, plumbed through the stack, then hard-rejected at runtime.

### Task 1.1: Remove CLI types from config

**Files:**

- Modify: `src/config/types.ts`
- Modify: `src/config/sections.ts`
- Modify: `src/config/parse-helpers.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Remove CLI types from `src/config/types.ts`**
  - Delete lines 3-27: `CliProvider`, `CliProviderConfig`, `CliAutoFallbackConfig`, `CliMagicAutoConfig`, `CliConfig`
  - Delete `ui` field (lines 231-236) from `SummarizeConfig`
  - Delete `cli` field (line 237) from `SummarizeConfig`

- [ ] **Step 2: Remove CLI parsing from `src/config/sections.ts`**
  - Remove import of `parseCliProvider` from parse-helpers (line 3)
  - Remove imports of CLI types: `CliAutoFallbackConfig`, `CliConfig`, `CliProvider`, `CliProviderConfig` (lines 10-14)
  - Delete `parseCliProviderList` function (lines 36-50)
  - Delete `parseCliProviderConfig` function (lines 52-72)
  - Delete `parseCliAutoFallbackConfig` function (lines 74-111)
  - Delete `parseCliConfig` function (lines 288-354)
  - Delete `parseUiConfig` function (lines 369-384)

- [ ] **Step 3: Remove `parseCliProvider` from `src/config/parse-helpers.ts`**
  - Remove `CliProvider` import (line 1)
  - Delete `parseCliProvider` function (lines 11-17)

- [ ] **Step 4: Update `src/config.ts`**
  - Remove `parseCliConfig` and `parseUiConfig` imports (lines 7, 15)
  - Remove CLI type re-exports: `CliAutoFallbackConfig`, `CliConfig`, `CliMagicAutoConfig`, `CliProvider`, `CliProviderConfig` (lines 25-29)
  - Remove `cli` and `ui` parsing calls and config assembly (lines 95, 97, 125-126)

### Task 1.2: Remove CLI transport from model spec and auto-selection

**Files:**

- Modify: `src/model-spec.ts`
- Modify: `src/model-auto.ts`
- Modify: `src/llm/provider-capabilities.ts`

- [ ] **Step 1: Remove CLI from `src/model-spec.ts`**
  - Remove `CliProvider` import (line 1)
  - Delete `DEFAULT_CLI_MODELS` constant (lines 4-9)
  - Delete CLI variant from `FixedModelSpec` union (lines 38-47)
  - Delete `cli/` parsing block from `parseRequestedModelId` (lines 119-156)
  - Update error message on line 160-161 to remove `cli/...` from examples

- [ ] **Step 2: Remove CLI from `src/llm/provider-capabilities.ts`**
  - Remove `CliProvider` import (line 1)
  - Remove `CLI_CLAUDE`, `CLI_CODEX`, `CLI_GEMINI`, `CLI_AGENT` from `RequiredModelEnv` (lines 13-16)
  - Delete `DEFAULT_CLI_MODELS` (lines 37-42)
  - Delete `DEFAULT_AUTO_CLI_ORDER` (line 44)
  - Delete `parseCliProviderName` function (lines 46-53)
  - Delete `requiredEnvForCliProvider` function (lines 55-63)
  - Update `envHasRequiredKey` — remove `CLI_*` cases (they were never `true` in server mode anyway, but the type union changes)

- [ ] **Step 3: Remove CLI from `src/model-auto.ts`**
  - Remove CLI-related imports: `CliAutoFallbackConfig`, `CliProvider` from config, `DEFAULT_AUTO_CLI_ORDER`, `DEFAULT_CLI_MODELS`, `parseCliProviderName`, `requiredEnvForCliProvider` from provider-capabilities (lines 5-6, 11-12, 14-15)
  - Remove `cliAvailability`, `allowAutoCliFallback`, `lastSuccessfulCliProvider` from `AutoSelectionInput` (lines 35-38)
  - Remove `"cli"` from `AutoModelAttempt.transport` union (line 42)
  - Delete `ResolvedCliAutoFallbackConfig` type (lines 189-193)
  - Delete `dedupeCliProviderOrder` (lines 195-201)
  - Delete `resolveCliAutoFallbackConfig` (lines 203-216)
  - Delete `hasAnyApiKeysConfigured` (lines 218-231)
  - Delete `prioritizeCliProvider` (lines 233-241)
  - Delete `isCliProviderEnabled` (lines 243-247)
  - Delete `isCandidateCli` (lines 253-255)
  - Delete `parseCliCandidate` (lines 257-270)
  - Delete `prependCliCandidates` (lines 360-413)
  - In `requiredEnvForCandidate`: remove CLI branch (lines 280-283)
  - In `buildAutoModelAttempts`: remove `prependCliCandidates` call (lines 454-461), simplify to just use `baseCandidates`
  - In `addAttempt` within `buildAutoModelAttempts`: remove all `transport === "cli"` branches (lines 494-501, 503, 510, 528-530, 541-542, 547-549)
  - Remove `explicitCli` check and `isCandidateCli` usage (lines 474, 479, 573-579)

### Task 1.3: Remove CLI from run infrastructure

**Files:**

- Modify: `src/run/types.ts`
- Modify: `src/run/run-config.ts`
- Modify: `src/run/run-context.ts`
- Modify: `src/run/run-env.ts`
- Modify: `src/run/env.ts`
- Modify: `src/run/summary-engine.ts`
- Modify: `src/run/streaming.ts`
- Modify: `src/run/run-settings.ts`
- Modify: `src/costs.ts`

- [ ] **Step 1: Clean `src/run/types.ts`**
  - Remove `CliProvider` import (line 1)
  - Remove `"cli"` from `ModelAttempt.transport` (line 17), `ModelAttemptRequiredEnv` (lines 11-14)
  - Remove `cliProvider?` and `cliModel?` fields (lines 26-27)
  - Remove `"cli"` from `ModelMeta.provider` (line 31)

- [ ] **Step 2: Clean `src/run/run-config.ts`**
  - Remove `CliProvider` import (line 1)
  - Remove `cliConfigForRun` and `configForCli` from `ConfigState` (lines 13-14)
  - Remove `cliFlagPresent` and `cliProviderArg` params from `resolveConfigState` (lines 24-25, 31-32)
  - Delete `cliEnabledOverride` logic (lines 57-68)
  - Simplify return to not include `cliConfigForRun`/`configForCli`

- [ ] **Step 3: Clean `src/run/run-context.ts`**
  - Remove `CliProvider` import (line 1)
  - Remove `cliFlagPresent` and `cliProviderArg` from function params and the call to `resolveConfigState`

- [ ] **Step 4: Clean `src/run/run-env.ts`**
  - Remove `CliProvider` import (line 2)
  - Remove `cliAvailability` from `EnvState` (line 27) and return value (line 158, 190)
  - Rename param `configForCli` → `config` in `resolveEnvState` (it's just the config now)

- [ ] **Step 5: Clean `src/run/env.ts`**
  - Remove `CliProvider` import (line 3)
  - Delete `parseCliUserModelId` function (lines 46-65)
  - Delete `parseCliProviderArg` function (lines 67-78)

- [ ] **Step 6: Clean `src/run/summary-engine.ts`**
  - Remove `"cli"` from `llmCalls` provider type (line 31)
  - In `envHasKeyFor`: remove the 4 `CLI_*` return-false guards (lines 99-102)
  - In `formatMissingModelError`: remove 4 `CLI_*` branches (lines 125-136)
  - In `runSummaryAttempt`: remove CLI transport guard (lines 160-164)

- [ ] **Step 7: Clean `src/run/streaming.ts`**
  - Remove `"cli"` from `canStream` transport param type (line 43)
  - Remove `if (transport === "cli") return false` (line 45)

- [ ] **Step 8: Clean `src/run/run-settings.ts`**
  - Remove `CliProvider` import (line 1) and related imports
  - Delete `parseCliProvider` local function (lines 56-63)
  - Delete `parseOptionalCliProviderOrder` (lines 65-89)
  - Delete `ResolvedRunSettings` type (lines 91-100)
  - Delete `resolveCliRunSettings` function (lines 165-218)
  - Remove `autoCliFallbackEnabled` and `autoCliOrder` from `RunOverrides` (lines 114-115)
  - Remove `autoCliFallback`, `autoCliOrder`, `autoCliRememberLastSuccess`, `magicCliAuto`, `magicCliOrder`, `magicCliRememberLastSuccess` from `RunOverridesInput` (lines 130-136)
  - In `resolveRunOverrides`: remove CLI fallback params from destructuring (lines 233-238), remove `autoCliFallbackEnabled`/`autoCliOrderResolved` computation (lines 328-340), remove from return object (lines 354-355)

- [ ] **Step 9: Clean `src/costs.ts`**
  - Remove `"cli"` from `LlmProvider` union (line 4)

### Task 1.4: Remove CLI from summarize layer

**Files:**

- Modify: `src/summarize/flow-context.ts`
- Modify: `src/summarize/models.ts`
- Modify: `src/summarize/chat.ts`

- [ ] **Step 1: Clean `src/summarize/flow-context.ts`**
  - Delete `applyAutoCliFallbackOverrides` function (lines 44-66)
  - Remove `cliConfigForRun` and `configForCli` from destructured result of `resolveRunContextState` (lines 160-162)
  - Remove `cliFlagPresent: false, cliProviderArg: null` from call to `resolveRunContextState` (lines 195-196)
  - Remove `configForCliWithMagic` variable and `applyAutoCliFallbackOverrides` call (line 198)
  - Remove `allowAutoCliFallback` variable (line 199)
  - Remove `autoCliFallbackEnabled` and `autoCliOrder` from `resolvedOverrides` default (lines 146-147)
  - Update `resolveModelSelection` call: `configForCli` → `config` (line 212-213)
  - Remove `allowAutoCliFallback` and `cliAvailability` from all contexts (lines 307, 311, 408, 414)

- [ ] **Step 2: Clean `src/summarize/models.ts`**
  - Remove `cliClaude`, `cliGemini`, `cliCodex`, `cliAgent` from providers object (lines 154-157)
  - Rename `configForCli` param to `config` in `buildModelPickerOptions` (line 123)

- [ ] **Step 3: Clean `src/summarize/chat.ts`**
  - Remove CLI transport guard (search for "CLI transport is not supported in server mode")

### Task 1.5: Run tests

- [ ] **Step 1:** Run `pnpm vitest run` and fix any test failures caused by removed types/functions
  - Tests in `tests/model-auto.test.ts`, `tests/config.test.ts`, `tests/config.more-branches.test.ts`, `tests/run.context.test.ts`, `tests/run.env.test.ts` will need updates to remove CLI-related test cases

---

## Chunk 2: Dead Code Removal

### Task 2.1: Remove dead exports and files

**Files:**

- Delete: `src/bun-sqlite.d.ts`
- Modify: `src/flags.ts`
- Modify: `src/run/constants.ts`

- [ ] **Step 1:** Delete `src/bun-sqlite.d.ts`

- [ ] **Step 2:** Remove dead functions from `src/flags.ts`:
  - Delete `parseExtractFormat` (lines 51-56)
  - Delete `parseStreamMode` (lines 67-71)
  - Delete `parseMetricsMode` (lines 73-79)
  - Delete `parseMaxExtractCharactersArg` (lines 136-158)
  - Keep types `ExtractFormat`, `StreamMode`, `MetricsMode` if used (check imports)

- [ ] **Step 3:** Remove `SUPPORT_URL` from `src/run/constants.ts` (line 8, dead — not imported anywhere)

- [ ] **Step 4:** Remove `isTTY = false` workaround from `src/summarize/flow-context.ts` line 40

### Task 2.2: Run tests

- [ ] **Step 1:** Run `pnpm vitest run` and fix any failures

---

## Chunk 3: Naming Cleanup

### Task 3.1: Rename extension-era types

**Files:**

- Modify: `src/summarize/pipeline.ts`
- Modify: `src/server/routes/summarize.ts`
- Modify: `tests/server.upload.test.ts`
- Modify: `tests/server.sse-streaming.test.ts`
- Modify: `tests/server.summarize.test.ts`

- [ ] **Step 1:** In `src/summarize/pipeline.ts`:
  - Rename `VisiblePageInput` → `TextInput`
  - Rename `streamSummaryForVisiblePage` → `streamSummaryForText`
  - Rename `VisiblePageMetrics` → `TextSummaryMetrics`

- [ ] **Step 2:** Update all call sites in `src/server/routes/summarize.ts`

- [ ] **Step 3:** Update test files that reference these names

### Task 3.2: Run tests

- [ ] **Step 1:** Run `pnpm vitest run`

---

## Chunk 4: Docs & Assets Cleanup

### Task 4.1: Delete stale docs

- [ ] **Step 1:** Delete CLI-focused docs:
  - `docs/extract-only.md`
  - `docs/website.md`
  - `docs/llm.md`
  - `docs/openai.md`
  - `docs/model-auto.md`
  - `docs/model-provider-resolution.md`
  - `docs/config.md`
  - `docs/README.md`
  - `docs/index.md`

- [ ] **Step 2:** Delete old assets:
  - `docs/assets/summarize-cli.png`
  - `docs/assets/summarize-extension.png`
  - `docs/assets/site.css`
  - `docs/assets/site.js`

- [ ] **Step 3:** Delete historical planning docs that reference deleted code:
  - `docs/superpowers/plans/2025-03-11-pipeline-timing.md`
  - `docs/superpowers/plans/2025-03-11-structured-insights.md`
  - `docs/superpowers/specs/2025-03-11-pipeline-timing-design.md`
  - `docs/superpowers/plans/2026-03-13-deprecate-extension-migrate-web.md`
  - `docs/superpowers/plans/2026-03-13-milestone-chunks-1-3-complete.md`
  - `docs/superpowers/specs/2026-03-13-deprecate-extension-migrate-web-design.md`

- [ ] **Step 4:** Update kept docs to remove CLI flag examples:
  - `docs/youtube.md` — remove `pnpm summarize -- --extract` examples
  - `docs/slides.md` — remove `summarize <url> --slides` examples, update to API usage
  - `docs/media.md`, `docs/firecrawl.md`, `docs/language.md` — check and update if needed

### Task 4.2: Run tests (sanity check — docs deletion can't break code)

- [ ] **Step 1:** Run `pnpm vitest run`

---

## Chunk 5: Fold `packages/core` into `src/core/`

This is the highest-risk chunk. It restructures the monorepo by moving the core package's source into the main src tree.

### Task 5.1: Move source files

- [ ] **Step 1:** Copy `packages/core/src/*` → `src/core/`
  - `src/core/index.ts`
  - `src/core/language.ts`
  - `src/core/processes.ts`
  - `src/core/content/` (all files)
  - `src/core/prompts/` (all files)
  - `src/core/transcription/` (all files)
  - `src/core/summarize/` (all files)
  - `src/core/shared/` (all files)
  - `src/core/openai/` (all files)

- [ ] **Step 2:** Fix internal imports within `src/core/` — the core package has one self-reference (`packages/core/src/shared/sse-events.ts` imports `@steipete/summarize_p2-core`). Change to relative path.

### Task 5.2: Update all imports

~25 src files + ~5 test files need updating. Replace `@steipete/summarize_p2-core` and its subpaths with relative imports to `src/core/`.

Import mapping:

- `@steipete/summarize_p2-core` → `./core/index.js` (relative from importer)
- `@steipete/summarize_p2-core/content` → `./core/content/index.js`
- `@steipete/summarize_p2-core/content/url` → `./core/content/url.js`
- `@steipete/summarize_p2-core/prompts` → `./core/prompts/index.js`
- `@steipete/summarize_p2-core/processes` → `./core/processes.js`
- `@steipete/summarize_p2-core/language` → `./core/language.js`
- `@steipete/summarize_p2-core/format` → `./core/shared/format.js`
- `@steipete/summarize_p2-core/summarize` → `./core/summarize/index.js`
- `@steipete/summarize_p2-core/sse` → `./core/shared/sse-events.js`

**Files to update (src/):**

- `src/firecrawl.ts`
- `src/llm/providers/openai.ts`
- `src/llm/html-to-markdown.ts`
- `src/language.ts`
- `src/summarize/pipeline.ts`
- `src/summarize/models.ts`
- `src/content/index.ts`
- `src/server/sse-session.ts`
- `src/server/routes/summarize.ts`
- `src/server/routes/slides.ts`
- `src/server/routes/chat.ts`
- `src/run/summary-engine.ts`
- `src/run/run-env.ts`
- `src/run/flows/url/summary.ts`
- `src/run/flows/url/slides-text.ts`
- `src/run/flows/url/extract.ts`
- `src/run/flows/url/flow.ts`
- `src/run/flows/asset/preprocess.ts`
- `src/run/flows/asset/extract.ts`
- `src/run/finish-line.ts`
- `src/run/attachments.ts`
- `src/prompts/index.ts`
- `src/processes.ts`
- `src/shared/contracts.ts`

**Test files to update:**

- `tests/server.sse-session.test.ts`
- `tests/sse-events.test.ts`
- `tests/server.sse-streaming.test.ts`
- `tests/tty.format.test.ts`
- `tests/sse-events-evolved.test.ts`

- [ ] **Step 1:** Update all src imports (compute correct relative paths from each file)
- [ ] **Step 2:** Update all test imports

### Task 5.3: Migrate dependencies

- [ ] **Step 1:** Move core's dependencies to root `package.json`:
  - `@fal-ai/client` ^1.9.4
  - `@mozilla/readability` 0.6.0
  - `cheerio` ^1.2.0
  - `es-toolkit` ^1.45.1
  - `jsdom` 28.1.0
  - `sanitize-html` ^2.17.1

- [ ] **Step 2:** Move core's devDependencies to root:
  - `@types/jsdom` ^28.0.0
  - `@types/sanitize-html` ^2.16.1

- [ ] **Step 3:** Remove `@steipete/summarize_p2-core` from root dependencies

### Task 5.4: Remove workspace package

- [ ] **Step 1:** Delete `packages/core/` directory entirely

- [ ] **Step 2:** Update `pnpm-workspace.yaml` — remove `packages/*` if no other packages remain

- [ ] **Step 3:** Update root `package.json` scripts:
  - Remove `build:core` from `build` script chain
  - Adjust `build:lib` if it references core
  - Adjust `clean` to not reference `packages/core/dist`

- [ ] **Step 4:** Remove "Pack (core)" step from `.github/workflows/ci.yml` (lines 44-59)

- [ ] **Step 5:** Update tsconfig files — remove path references to packages/core

- [ ] **Step 6:** Run `pnpm install` to update lockfile

### Task 5.5: Build and test

- [ ] **Step 1:** Run `pnpm build` — verify TypeScript compilation
- [ ] **Step 2:** Run `pnpm vitest run` — verify all tests pass

---

## Chunk 6: Final Cleanup

### Task 6.1: Config and build cleanup

- [ ] **Step 1:** Remove `"DOM"` from `tsconfig.base.json` `lib` array (server-only code)
- [ ] **Step 2:** Delete `.npmrc` (empty file)
- [ ] **Step 3:** Delete `.worktrees/deprecate-extension/` directory if present
- [ ] **Step 4:** Remove `buildPathSummaryPrompt` from core prompts (now at `src/core/prompts/cli.ts`) — delete the file

### Task 6.2: Clean up tests

- [ ] **Step 1:** Remove CLI-specific test cases from:
  - `tests/run.env.test.ts` — remove `parseCliUserModelId`, `parseCliProviderArg` tests
  - `tests/model-auto.test.ts` — remove CLI fallback tests
  - `tests/config.test.ts` / `tests/config.more-branches.test.ts` — remove `parseCliConfig` tests
  - `tests/prompts.cli.test.ts` — delete file (tests `buildPathSummaryPrompt` which is being removed)
  - `tests/prompts.override.test.ts` — remove `buildPathSummaryPrompt` references
  - `tests/run.tips.test.ts` — keep (tests `withUvxTip` which stays)

### Task 6.3: Update coverage thresholds and final verification

- [ ] **Step 1:** Run `pnpm vitest run --coverage` and update `vitest.config.ts` thresholds
- [ ] **Step 2:** Run `pnpm build` — verify full build succeeds
- [ ] **Step 3:** Run `pnpm -s check` — verify lint + format + test all pass
