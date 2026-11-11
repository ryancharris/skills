/**
 * The search fallback's results are not filtered to the named company, so for a company
 * with no readable board the output must say they may be other companies' roles.
 * Offline: no adapters (no board reads) and a fake search provider.
 */
import { describe, expect, it } from "vitest";

import { peerWarning, runSearch } from "../src/pipeline.js";
import { emptyProfile } from "../src/models.js";
import type { SearchProvider, SearchResult } from "../src/search.js";

class FakeProvider {
  readonly name = "fake";
  queries: string[] = [];
  async search(query: string): Promise<SearchResult[]> {
    this.queries.push(query);
    return [
      {
        title: "Chief of Staff at Anduril",
        url: "https://job-boards.greenhouse.io/anduril/jobs/123",
        snippet: "A role at another company",
      },
    ];
  }
}

const profile = { ...emptyProfile(), titles: ["chief of staff"] };

describe("search fallback for a company with no readable board", () => {
  it("says the results may be other companies' roles", async () => {
    const provider = new FakeProvider();
    const result = await runSearch(profile, {
      companies: ["Amazon"],
      maxCompanies: 1,
      adapters: [],
      provider: provider as never,
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.warnings).toContain(peerWarning(["Amazon"], 1));
    expect(result.warnings.join("\n")).toContain("No readable job board for Amazon");
    expect(result.warnings.join("\n")).toContain("may be roles at other companies");
  });

  it("the fallback query does not name the company (the reason the warning is needed)", async () => {
    const provider = new FakeProvider();
    await runSearch(profile, {
      companies: ["Amazon"],
      maxCompanies: 1,
      adapters: [],
      provider: provider as never,
    });
    expect(provider.queries.length).toBeGreaterThan(0);
    for (const q of provider.queries) expect(q).not.toContain("Amazon");
  });

  it("names every unreadable company in one warning", async () => {
    const provider = new FakeProvider();
    const result = await runSearch(profile, {
      companies: ["Amazon", "Zzqx Holdings"],
      maxCompanies: 2,
      adapters: [],
      provider: provider as never,
    });
    const peer = result.warnings.filter((w) => w.startsWith("No readable job board"));
    expect(peer).toHaveLength(1);
    expect(peer[0]).toContain("Amazon, Zzqx Holdings");
  });

  it("adds no peer warning when the fallback finds nothing", async () => {
    const empty: SearchProvider = { name: "fake", search: async () => [] } as never;
    const result = await runSearch(profile, {
      companies: ["Amazon"],
      maxCompanies: 1,
      adapters: [],
      provider: empty as never,
    });
    expect(result.warnings.some((w) => w.startsWith("No readable job board"))).toBe(false);
  });
});
