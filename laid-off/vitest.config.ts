import { defineConfig } from "vitest/config";

const live = process.env.JOBSEARCH_LIVE_TESTS === "1";

export default defineConfig({
  test: {
    include: ["tests-ts/**/*.test.ts"],
    exclude: live ? [] : ["tests-ts/live/**"],
    testTimeout: live ? 60_000 : 5_000,
  },
});
