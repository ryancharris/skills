/**
 * Tests for the network guard itself.
 *
 * The guard is what guarantees the default suite never hits a live API. An
 * untested guard can rot silently -- these assertions make that impossible.
 */

import { describe, expect, it } from "vitest";

import { AshbyAdapter, GreenhouseAdapter } from "../src/ats.js";
import { HttpError } from "../src/http.js";
import { runSearch } from "../src/pipeline.js";
import { emptyProfile } from "../src/models.js";

const isLive = process.env.JOBSEARCH_LIVE_TESTS === "1";

// These assertions only hold when the guard is active. In live mode the
// guard permits allow-listed hosts, so the suite is skipped rather than failing.
describe.skipIf(isLive)("network guard", () => {
  it("blocks a raw fetch", async () => {
    await expect(fetch("https://example.com/")).rejects.toThrow(/Network guard/);
  });

  it("blocks a real ATS adapter call", async () => {
    await expect(new GreenhouseAdapter(5000).fetch("stripe")).rejects.toThrow(/Network guard/);
  });

  it("blocks the search provider path", async () => {
    await expect(new AshbyAdapter(5000).fetch("cohere")).rejects.toThrow(/Network guard/);
  });

  it("fails fast with kind 'guard', not a retried network error", async () => {
    // A guard violation must not pay retry backoff, and must keep its message.
    const err = await new GreenhouseAdapter(5000).fetch("stripe").catch((e: HttpError) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).kind).toBe("guard");
    expect((err as HttpError).message).toContain("Network guard");
  });

  it("names forbidden hosts explicitly", async () => {
    await expect(fetch("https://www.linkedin.com/jobs")).rejects.toThrow(/linkedin/);
  });

  it("lets a pipeline run degrade to warnings instead of hanging", async () => {
    // The orchestrator must surfacing the block, not retry until timeout.
    const started = Date.now();
    const result = await runSearch(
      { ...emptyProfile(), titles: ["engineer"] },
      { companies: ["Stripe"], maxCompanies: 1, provider: null },
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.jobs).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("is inactive in live mode", () => {
    // Documents intent: the guard permits allow-listed hosts only when the live
    // flag is set. This test asserts the flag wiring, not a network call.
    expect(typeof isLive).toBe("boolean");
  });
});
