/**
 * Live network tests against real ATS endpoints. Opt-in: run with `npm run test:live`.
 * Never in CI.
 *
 * These exist because the vendor quirks that broke this skill (identity collisions,
 * Ashby's 403 without a User-Agent, SmartRecruiters' 200-on-missing-slug and paged
 * counts, BambooHR's HTML error page) are invisible to mocks.
 *
 * Rules for these tests (round 19: they had failed on data that changed upstream):
 *   1. Assert the contract, not the data. A count must equal the vendor's own count;
 *      a field must have the right shape. No test pins a company's size, salary or
 *      department list.
 *   2. A named account is a candidate list. The first candidate that answers is used.
 *   3. If no candidate has usable data, the test is SKIPPED with a reason, and the
 *      reason is printed. A skip is visible; a pass that checked nothing is not.
 *      A failure means the adapter got a real response wrong, or the network broke.
 *   4. "Absent" means the vendor said 404/410 or answered with a non-JSON page. Any
 *      other error (network, guard, adapter bug) fails the test.
 */

import { describe, expect, it } from "vitest";

/** The part of vitest's test context these tests use. */
type SkippableContext = { skip: () => void };

import {
  AshbyAdapter,
  BambooHRAdapter,
  GreenhouseAdapter,
  LeverAdapter,
  SmartRecruitersAdapter,
} from "../../src/ats.js";
import { ashbyPayForLocation } from "../../src/ats.js";
import { discoverBoards } from "../../src/discovery.js";
import { HttpError, getJson } from "../../src/http.js";
import { emptyProfile, type Job } from "../../src/models.js";
import { dedupeJobs } from "../../src/output.js";
import { checkHiring, runSearch } from "../../src/pipeline.js";

const TIMEOUT = 30_000;

const GREENHOUSE = ["stripe", "airbnb", "cloudflare", "figma"];
const ASHBY = ["ramp", "notion", "cohere", "openai"];
const LEVER = ["palantir", "spotify"];
const SMARTRECRUITERS_LARGE = ["servicenow", "aramark", "experian"];
const BAMBOOHR = ["walmart"];

/** True when the vendor says the account is absent, rather than the adapter being wrong. */
function isAbsent(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  return err.kind === "parse" || (err.kind === "status" && (err.status === 404 || err.status === 410));
}

/** Try candidates in order; return the first that answers with usable data. */
async function firstLive<T>(
  candidates: readonly string[],
  load: (slug: string) => Promise<T>,
  usable: (value: T) => boolean = () => true,
): Promise<{ slug: string; value: T } | null> {
  for (const slug of candidates) {
    try {
      const value = await load(slug);
      if (usable(value)) return { slug, value };
    } catch (err) {
      if (isAbsent(err)) continue;
      throw err;
    }
  }
  return null;
}

/** Print the reason (so the skip is never silent), then skip. vitest's skip takes no message. */
function skipWith(ctx: SkippableContext, what: string, candidates: readonly string[]): void {
  console.log(`SKIP ${what}: no candidate (${candidates.join(", ")}) currently has usable data. Update the list.`);
  ctx.skip();
}

describe("adapters", () => {
  it("Greenhouse returns the expected shape", async (ctx) => {
    const pick = await firstLive(GREENHOUSE, (s) => new GreenhouseAdapter(TIMEOUT).fetch(s), (j) => j.length > 0);
    if (!pick) return skipWith(ctx, "Greenhouse shape", GREENHOUSE);
    const first = pick.value[0]!;
    expect(first.source).toBe("greenhouse");
    expect(first.title).toBeTruthy();
    expect(first.url.startsWith("https://")).toBe(true);
    expect(first.identifier).toBeTruthy();
  });

  // Contract: nothing is dropped. The adapter's count must equal the vendor's own list.
  it("Greenhouse keeps every posting: the count equals the vendor's count", async (ctx) => {
    const pick = await firstLive(GREENHOUSE, async (s) => {
      const raw = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, { timeout: TIMEOUT })) as { jobs?: unknown[] };
      const jobs = await new GreenhouseAdapter(TIMEOUT).fetch(s);
      return { vendor: raw.jobs?.length ?? 0, adapter: jobs.length, jobs };
    }, (v) => v.vendor > 0);
    if (!pick) return skipWith(ctx, "Greenhouse count", GREENHOUSE);
    expect(pick.value.adapter).toBe(pick.value.vendor);
    // A missing department is an empty string (kept), never undefined and never a drop.
    expect(pick.value.jobs.every((j) => typeof j.department === "string")).toBe(true);
  });

  it("Greenhouse unknown slug fails", async () => {
    await expect(new GreenhouseAdapter(TIMEOUT).fetch("zzzznotarealcompany123456")).rejects.toThrow();
  });

  it("Ashby returns postings with the expected shape", async (ctx) => {
    const pick = await firstLive(ASHBY, (s) => new AshbyAdapter(TIMEOUT).fetch(s), (j) => j.length > 0);
    if (!pick) return skipWith(ctx, "Ashby shape", ASHBY);
    expect(pick.value[0]?.url.startsWith("https://jobs.ashbyhq.com/")).toBe(true);
  });

  // Contract: the adapter quotes CA$ for a Canadian role that the vendor publishes in CAD,
  // and never labels a USD-only figure as CA$. Checked against the vendor's raw data, so
  // no particular posting, title or amount is needed.
  it("Ashby quotes the pay currency the vendor publishes for the location", async (ctx) => {
    type Row = { location: string; currencies: Set<string>; compensation: string | null };
    const rows: Row[] = [];
    for (const slug of ASHBY) {
      let raw: { jobs?: Array<{ location?: string; compensation?: unknown }> };
      try {
        raw = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`, {
          timeout: TIMEOUT,
        })) as typeof raw;
      } catch (err) {
        if (isAbsent(err)) continue;
        throw err;
      }
      for (const job of raw.jobs ?? []) {
        const location = job.location ?? "";
        const tiers = ((job.compensation as { compensationTiers?: unknown[] } | undefined)?.compensationTiers ?? []) as Array<{
          components?: Array<{ compensationType?: string; currencyCode?: string }>;
        }>;
        const currencies = new Set<string>();
        for (const tier of tiers) {
          for (const c of tier.components ?? []) {
            if (c.compensationType === "Salary" && c.currencyCode) currencies.add(c.currencyCode);
          }
        }
        const quoted = ashbyPayForLocation(job.compensation, location);
        rows.push({ location, currencies, compensation: quoted });
      }
    }
    const canadianCad = rows.filter((r) => /canada|toronto|vancouver|montreal/i.test(r.location) && r.currencies.has("CAD"));
    if (canadianCad.length === 0) return skipWith(ctx, "Ashby CAD pay (no Canadian role with a CAD tier right now)", ASHBY);
    for (const r of canadianCad) expect(r.compensation ?? "", r.location).toContain("CA$");
    const usdOnly = rows.filter((r) => r.currencies.size > 0 && !r.currencies.has("CAD") && r.compensation);
    for (const r of usdOnly) expect(r.compensation ?? "", r.location).not.toContain("CA$");
  });

  it("Lever returns hosted URLs", async (ctx) => {
    const pick = await firstLive(LEVER, (s) => new LeverAdapter(TIMEOUT).fetch(s), (j) => j.length > 0);
    if (!pick) return skipWith(ctx, "Lever hosted URLs", LEVER);
    expect(pick.value.every((j) => j.url.startsWith("https://jobs.lever.co/"))).toBe(true);
  });

  // Contract: every posting the vendor reports is read. Paging is exercised only when a
  // candidate board is larger than one page.
  it("SmartRecruiters reads every posting the vendor reports", async (ctx) => {
    const pick = await firstLive(SMARTRECRUITERS_LARGE, async (s) => {
      const adapter = new SmartRecruitersAdapter(TIMEOUT);
      const total = await adapter.totalCount(s);
      const jobs = await adapter.fetch(s);
      return { total, jobs };
    }, (v) => v.total > 0);
    if (!pick) return skipWith(ctx, "SmartRecruiters reads", SMARTRECRUITERS_LARGE);
    expect(pick.value.jobs).toHaveLength(pick.value.total);
    expect(new Set(pick.value.jobs.map((j) => j.identifier)).size).toBe(pick.value.jobs.length);
    if (pick.value.total <= 100) {
      console.log(`note: no SmartRecruiters candidate above one page right now; paging was not exercised live`);
    }
  });

  it("SmartRecruiters unknown slug is empty, not an error", async () => {
    expect(await new SmartRecruitersAdapter(TIMEOUT).isValidSlug("zzzznotarealcompany123456")).toBe(false);
  });

  it("BambooHR returns postings for a tenant that serves JSON", async (ctx) => {
    const pick = await firstLive(BAMBOOHR, (s) => new BambooHRAdapter(TIMEOUT).fetch(s), (j) => j.length > 0);
    if (!pick) return skipWith(ctx, "BambooHR postings", BAMBOOHR);
    expect(pick.value[0]?.source).toBe("bamboohr");
  });

  it("BambooHR unknown tenant returns HTML, not a crash", async () => {
    const adapter = new BambooHRAdapter(TIMEOUT);
    await expect(adapter.fetch("definitelynotatenant123")).rejects.toBeInstanceOf(HttpError);
    expect(await adapter.isValidSlug("definitelynotatenant123")).toBe(false);
  });
});

describe("discovery", () => {
  // Contract: a company with a public board is found. Which platform it uses may change.
  it("finds a live board for a company that has one", async (ctx) => {
    const names = ["Stripe", "Notion", "Figma"];
    for (const name of names) {
      const boards = await discoverBoards(name);
      if (boards.length > 0) {
        expect(boards.every((b) => b.job_count >= 0)).toBe(true);
        return;
      }
    }
    skipWith(ctx, "discovery", names);
  });

  // Contract: names with no board are rejected. Fictional names keep this stable.
  it.each([["Zzqx Motors Holdings"], ["Zzqx Paper Company"]])("rejects look-alike boards for %s", async (company) => {
    expect(await discoverBoards(company)).toEqual([]);
  });

  // Contract: boards come back largest first.
  it("returns boards largest first", async (ctx) => {
    for (const name of ["Ramp", "Stripe", "Notion"]) {
      const boards = await discoverBoards(name);
      if (boards.length < 2) continue;
      for (let i = 0; i + 1 < boards.length; i += 1) {
        expect(boards[i]!.job_count).toBeGreaterThanOrEqual(boards[i + 1]!.job_count);
      }
      return;
    }
    console.log("SKIP boards ordering: no company in the list has two boards right now.");
    ctx.skip();
  });

  it("reports a transient failure instead of silence", async () => {
    class Flaky extends GreenhouseAdapter {
      override async fetch(): Promise<never> {
        throw new Error("temporary DNS failure");
      }
    }
    const errors: string[] = [];
    const boards = await discoverBoards("Stripe", { adapters: [new Flaky(TIMEOUT)], errors });
    expect(boards).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("incomplete");
  });

  it("stays quiet for a genuine miss", async () => {
    class Missing extends GreenhouseAdapter {
      override async fetch(): Promise<never> {
        throw new HttpError("u", 404, "not found");
      }
    }
    const errors: string[] = [];
    await discoverBoards("Amazon", { adapters: [new Missing(TIMEOUT)], errors });
    expect(errors).toEqual([]);
  });
});

describe("end to end", () => {
  // Contract: every returned job satisfies the filters that were asked for.
  it("every job from a real search satisfies the filters", async (ctx) => {
    const profile = { ...emptyProfile(), titles: ["engineer"] };
    const result = await runSearch(profile, { companies: ["Stripe"], maxCompanies: 1 });
    if (result.jobs.length === 0) return skipWith(ctx, "end-to-end search", ["Stripe"]);
    expect(result.boards.length).toBeGreaterThan(0);
    expect(result.jobs.every((j) => j.title.toLowerCase().includes("engineer"))).toBe(true);
    expect(dedupeJobs(result.jobs)).toHaveLength(result.jobs.length);
  });

  it("offers boolean site queries", async () => {
    const result = await runSearch({ ...emptyProfile(), titles: ["chief of staff"] }, { companies: ["Stripe"] });
    const matches = result.queries.filter((q) => q.startsWith("site:jobs.ashbyhq.com"));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toContain('"CoS"');
  });

  // Contract: a board that exists is read, and its roles and departments are reported.
  it("check reports a live board with roles and departments", async (ctx) => {
    const result = await checkHiring(["Stripe"]);
    const signal = result.signals[0]!;
    if (signal.unknown) return skipWith(ctx, "check on a live board", ["Stripe"]);
    expect(signal.open_roles).toBeGreaterThan(0);
    expect(signal.top_departments.length).toBeGreaterThan(0);
    expect(signal.board_count).toBeGreaterThanOrEqual(1);
  });

  // Amazon has no supported board by design (SCOPE.md, SKILL.md "Known limitations").
  it("check marks an enterprise as unknown and suggests a query", async () => {
    const result = await checkHiring(["Amazon"]);
    expect(result.signals[0]?.unknown).toBe(true);
    expect(result.queries.some((q) => q.includes("Amazon"))).toBe(true);
  });
});
