/**
 * A discovered board is shown under the vendor's own name when it has one, not under
 * whatever the user typed ("stripe", "Stripe Inc"). The name is the one identity
 * verification already checked, so it changes the label only: which boards are found,
 * and which are rejected, stays the same. Offline: a Greenhouse adapter with a synthetic board.
 */
import { describe, expect, it } from "vitest";

import { ATSAdapter, GreenhouseAdapter } from "../src/ats.js";
import { discoverBoards } from "../src/discovery.js";
import { HttpError } from "../src/http.js";
import { emptyProfile, makeJob } from "../src/models.js";
import { checkHiring, runSearch } from "../src/pipeline.js";

/** Serves `boards[slug] = company_name` on the Greenhouse jobs URL; 404 for any other slug. */
class FakeGreenhouse extends GreenhouseAdapter {
  constructor(private readonly boards: Record<string, string>) {
    super();
  }

  protected override async get(url: string): Promise<Record<string, unknown>> {
    const match = /\/boards\/([^/]+)\/(jobs|departments)$/.exec(url);
    const name = match ? this.boards[match[1] as string] : undefined;
    if (!match || name === undefined) throw new HttpError(url, 404, "not found");
    if (match[2] === "departments") return { departments: [] };
    return {
      jobs: [
        {
          id: 1,
          title: "Software Engineer",
          company_name: name,
          absolute_url: `https://example.com/${match[1]}/1`,
          location: { name: "Remote" },
          first_published: "2026-11-10T00:00:00Z",
        },
      ],
    };
  }
}

const profile = { ...emptyProfile(), titles: ["software engineer"] };
// 20s matches the adapters' default timeout, so the pipeline reuses the fake instead of rebuilding it.
const config = { http_timeout: 20, cache_ttl: 0, cache_dir: "" } as never;

describe("board display name", () => {
  it.each(["Stripe", "stripe", "Stripe Inc"])("%s is shown as the vendor's name", async (typed) => {
    const boards = await discoverBoards(typed, { adapters: [new FakeGreenhouse({ stripe: "Stripe" })] });
    expect(boards).toEqual([
      { company: "Stripe", ats: "greenhouse", slug: "stripe", job_count: 1, url: "" },
    ]);
  });

  it("keeps the vendor's capitalisation", async () => {
    const boards = await discoverBoards("gitlab", { adapters: [new FakeGreenhouse({ gitlab: "GitLab" })] });
    expect(boards.map((b) => b.company)).toEqual(["GitLab"]);
  });

  it("flattens a vendor name to one line", async () => {
    const boards = await discoverBoards("stripe", {
      adapters: [new FakeGreenhouse({ stripe: "Stripe\n  Inc" })],
    });
    expect(boards.map((b) => b.company)).toEqual(["Stripe Inc"]);
  });

  it("still rejects a look-alike board", async () => {
    const adapters = [new FakeGreenhouse({ general: "General Interest", generalmotors: "General Interest" })];
    expect(await discoverBoards("General Motors", { adapters })).toEqual([]);
  });

  it("keeps the typed name when the vendor gives none", async () => {
    class NoName extends ATSAdapter {
      override readonly name = "ashby";
      async fetch() {
        return [makeJob({ title: "Engineer", company: "acme", url: "https://example.com/1", source: "ashby" })];
      }
    }
    const boards = await discoverBoards("acme corp", { adapters: [new NoName()] });
    expect(boards.map((b) => b.company)).toEqual(["acme corp"]);
  });

  it("a search still treats the company as resolved when the board is renamed", async () => {
    const adapters = [new FakeGreenhouse({ stripe: "Stripe" })];
    const result = await runSearch(profile, { companies: ["stripe", "zzqx"], adapters, config, provider: null });
    expect(result.boards?.map((b) => b.company)).toEqual(["Stripe"]);
    expect(result.jobs.map((j) => j.company)).toEqual(["Stripe"]);
    // Only the company with no board gets a discovery query.
    const discovery = result.queries.filter((q) => q.includes("careers OR jobs"));
    expect(discovery).toEqual(['"zzqx" (careers OR jobs) (greenhouse OR lever OR ashby OR workday)']);
  });

  it("--check keeps the typed name on the signal and the vendor's name on its boards", async () => {
    const adapters = [new FakeGreenhouse({ stripe: "Stripe" })];
    const result = await checkHiring(["stripe"], { adapters, config });
    const signal = result.signals[0];
    expect(signal?.company).toBe("stripe");
    expect(signal?.unknown).toBe(false);
    expect(signal?.boards.map((b) => b.company)).toEqual(["Stripe"]);
    expect(result.queries).toEqual([]);
  });
});
