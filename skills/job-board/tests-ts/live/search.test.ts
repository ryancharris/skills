/**
 * Live search providers: one real query each for Brave and Exa. Opt-in (`npm run test:live`),
 * never in CI, and each query is billed to the key that is set.
 *
 * Keys come from their own variables, not from JOB_BOARD_SEARCH_API_KEY, so a key set
 * for the skill (for example Kagi) can never be spent by these tests by accident:
 *   LIVE_KAGI_API_KEY    LIVE_BRAVE_API_KEY    LIVE_EXA_API_KEY
 * With a key unset the test is skipped and the skip reason is printed. Each test makes
 * exactly one search, with a limit of 3.
 *
 * Why this exists: Brave and Exa were checked against their documentation and against
 * rejected keys, but no successful search had been run. This test is that run.
 */

import { describe, expect, it } from "vitest";

import { BraveProvider, ExaProvider, KagiProvider, type SearchResult } from "../../src/search.js";

const TIMEOUT = 30_000;
const QUERY = 'site:jobs.ashbyhq.com ("chief of staff")';

const KAGI_KEY = process.env.LIVE_KAGI_API_KEY ?? "";
const BRAVE_KEY = process.env.LIVE_BRAVE_API_KEY ?? "";
const EXA_KEY = process.env.LIVE_EXA_API_KEY ?? "";

if (!KAGI_KEY) console.log("SKIP kagi live search: LIVE_KAGI_API_KEY is not set");
if (!BRAVE_KEY) console.log("SKIP brave live search: LIVE_BRAVE_API_KEY is not set");
if (!EXA_KEY) console.log("SKIP exa live search: LIVE_EXA_API_KEY is not set");

/** The contract a real search must meet, whatever the provider's index returns. */
function expectUsableResults(results: SearchResult[]): void {
  expect(results.length, "a real search returned no results").toBeGreaterThanOrEqual(1);
  for (const r of results) {
    expect(r.url.startsWith("https://"), r.url).toBe(true);
    expect(typeof r.title).toBe("string");
    expect(typeof r.snippet).toBe("string");
  }
}

describe("live search providers", () => {
  it.skipIf(!KAGI_KEY)("Kagi returns usable results for one real search", async () => {
    const results = await new KagiProvider(KAGI_KEY, TIMEOUT).search(QUERY, 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expectUsableResults(results);
  });

  it.skipIf(!BRAVE_KEY)("Brave returns usable results for one real search", async () => {
    const results = await new BraveProvider(BRAVE_KEY, TIMEOUT).search(QUERY, 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expectUsableResults(results);
  });

  it.skipIf(!EXA_KEY)("Exa returns usable results for one real search", async () => {
    const results = await new ExaProvider(EXA_KEY, TIMEOUT).search(QUERY, 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expectUsableResults(results);
  });
});
