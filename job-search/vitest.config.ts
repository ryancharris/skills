import { defineConfig } from "vitest/config";

const live = process.env.JOBSEARCH_LIVE_TESTS === "1";

export default defineConfig({
  test: {
    include: ["tests-ts/**/*.test.ts"],
    // Live tests hit real APIs; gated exactly like the Python suite.
    exclude: live ? [] : ["tests-ts/live.test.ts"],
    // Boards can span several pages (Aramark is 603 postings across 7 requests,
    // ~6s). The default 5s is not enough for the pagination test.
    testTimeout: live ? 60_000 : 5_000,
  },
});
