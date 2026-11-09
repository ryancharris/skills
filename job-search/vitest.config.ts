import { defineConfig } from "vitest/config";

/**
 * Two suites, deliberately separated.
 *
 * `npm test` must never touch a live API. That is enforced in two layers:
 *  1. tests under `tests-ts/live/` are only collected when JOBSEARCH_LIVE_TESTS=1
 *  2. `tests-ts/setup.ts` blocks fetch at runtime for everything else
 *
 * A config `exclude` alone was too weak: it is one edit away from silently
 * running the network in CI.
 */
const live = process.env.JOBSEARCH_LIVE_TESTS === "1";

export default defineConfig({
  test: {
    globalSetup: [],
    setupFiles: ["tests-ts/setup.ts"],
    include: live ? ["tests-ts/**/*.test.ts"] : ["tests-ts/**/*.test.ts"],
    exclude: live
      ? ["**/node_modules/**"]
      : ["**/node_modules/**", "tests-ts/live/**"],
    // A live board can span several pages (Aramark is 603 postings, ~6s).
    testTimeout: live ? 60_000 : 5_000,
  },
});
