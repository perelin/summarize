import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));
const cpuCount = Math.max(1, cpus().length);
const envMaxThreads = Number.parseInt(process.env.VITEST_MAX_THREADS ?? "", 10);
const maxThreads = Number.isFinite(envMaxThreads)
  ? envMaxThreads
  : Math.min(8, Math.max(4, Math.floor(cpuCount / 2)));
const coverageReporters = process.env.CI
  ? ["text", "json-summary", "html"]
  : ["text", "json-summary"];

export default defineConfig({
  poolOptions: {
    threads: {
      minThreads: 1,
      maxThreads,
    },
  },
  resolve: {
    alias: [
      {
        find: /^@steipete\/summarize_p2-core\/content$/,
        replacement: resolve(rootDir, "packages/core/src/content/index.ts"),
      },
      {
        find: /^@steipete\/summarize_p2-core\/content\/url$/,
        replacement: resolve(rootDir, "packages/core/src/content/url.ts"),
      },
      {
        find: /^@steipete\/summarize_p2-core\/prompts$/,
        replacement: resolve(rootDir, "packages/core/src/prompts/index.ts"),
      },
      {
        find: /^@steipete\/summarize_p2-core\/language$/,
        replacement: resolve(rootDir, "packages/core/src/language.ts"),
      },
      {
        find: /^@steipete\/summarize_p2-core\/format$/,
        replacement: resolve(rootDir, "packages/core/src/shared/format.ts"),
      },
      {
        find: /^@steipete\/summarize_p2-core\/summarize$/,
        replacement: resolve(rootDir, "packages/core/src/summarize/index.ts"),
      },
      {
        find: /^@steipete\/summarize_p2-core\/sse$/,
        replacement: resolve(rootDir, "packages/core/src/shared/sse-events.ts"),
      },
      {
        find: /^@steipete\/summarize_p2-core$/,
        replacement: resolve(rootDir, "packages/core/src/index.ts"),
      },
      // Force @fal-ai/client to resolve from its single install location
      // (nested under packages/core) so vi.mock intercepts correctly.
      {
        find: "@fal-ai/client",
        replacement: resolve(rootDir, "packages/core/node_modules/@fal-ai/client"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: coverageReporters,
      include: ["src/**/*.ts", "packages/core/src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/dist/**",
        "**/node_modules/**",
        "tests/**",
        // Slide extraction is integration-tested; unit coverage is too noisy.
        "src/slides/extract.ts",
        // OS/browser integration (exec/sqlite/keychain); covered via higher-level tests.
        "**/src/content/transcript/providers/twitter-cookies-*.ts",
        // Barrels / type-only entrypoints (noise for coverage).
        "src/**/index.ts",
        "src/**/types.ts",
        "src/**/deps.ts",
      ],
      thresholds: {
        // Adjusted after removing CLI/extension/TTY code (Chunks 1-6).
        branches: 57,
        functions: 70,
        lines: 67,
        statements: 68,
      },
    },
  },
});
