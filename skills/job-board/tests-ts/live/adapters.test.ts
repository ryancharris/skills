/**
 * Live network tests against real ATS endpoints.
 *
 * Ported from the earlier Python implementation (removed; see CHANGELOG). Run with JOBSEARCH_LIVE_TESTS=1.
 *
 * These exist because the vendor quirks that actually broke this skill (identity
 * collisions, Ashby's 403 without a User-Agent, SmartRecruiters' 200-on-missing-
 * slug and paged counts, BambooHR's HTML error page) are invisible to mocks.
 */

import { describe, expect, it } from "vitest";

import {
  AshbyAdapter,
  BambooHRAdapter,
  GreenhouseAdapter,
  LeverAdapter,
  SmartRecruitersAdapter,
} from "../../src/ats.js";
import { discoverBoards } from "../../src/discovery.js";
import { HttpError } from "../../src/http.js";
import { emptyProfile } from "../../src/models.js";
import { dedupeJobs } from "../../src/output.js";
import { checkHiring, runSearch } from "../../src/pipeline.js";

const TIMEOUT = 30_000;

describe("adapters", () => {
  it("Greenhouse returns the expected shape", async () => {
    const jobs = await new GreenhouseAdapter(TIMEOUT).fetch("stripe");
    expect(jobs.length).toBeGreaterThan(100);
    const first = jobs[0]!;
    expect(first.source).toBe("greenhouse");
    expect(first.title).toBeTruthy();
    expect(first.url.startsWith("http")).toBe(true);
    expect(first.identifier).toBeTruthy();
    expect(jobs.some((j) => j.company === "Stripe")).toBe(true);
  });

  it("Greenhouse labels every posting with a department", async () => {
    const jobs = await new GreenhouseAdapter(TIMEOUT).fetch("stripe");
    const unlabeled = jobs.filter((j) => !j.department);
    expect(unlabeled).toHaveLength(0);
    expect(new Set(jobs.map((j) => j.department)).size).toBeGreaterThanOrEqual(2);
  });

  it("Greenhouse unknown slug fails", async () => {
    await expect(new GreenhouseAdapter(TIMEOUT).fetch("zzzznotarealcompany123456")).rejects.toThrow();
  });

  it("Ashby works without an explicit User-Agent override and carries pay", async () => {
    const jobs = await new AshbyAdapter(TIMEOUT).fetch("ramp");
    expect(jobs.length).toBeGreaterThan(50);
    expect(jobs[0]?.url.startsWith("https://jobs.ashbyhq.com/")).toBe(true);
    expect(jobs.some((j) => j.compensation)).toBe(true);
  });

  it("Lever returns hosted URLs", async () => {
    const jobs = await new LeverAdapter(TIMEOUT).fetch("palantir");
    expect(jobs.length).toBeGreaterThan(10);
    expect(jobs.every((j) => j.url.startsWith("https://jobs.lever.co/"))).toBe(true);
  });

  it("SmartRecruiters pages past the first 100", async () => {
    const adapter = new SmartRecruitersAdapter(TIMEOUT);
    const jobs = await adapter.fetch("aramark");
    const total = await adapter.totalCount("aramark");
    expect(total).toBeGreaterThan(100);
    expect(jobs).toHaveLength(total);
    expect(new Set(jobs.map((j) => j.identifier)).size).toBe(jobs.length);
  });

  it("SmartRecruiters unknown slug is empty, not an error", async () => {
    expect(await new SmartRecruitersAdapter(TIMEOUT).isValidSlug("zzzznotarealcompany123456")).toBe(false);
  });

  // Tenant chosen 2026-11-11: the old fixture ("test") now redirects to an HTML page.
  // Re-check the tenant with curl before changing it again.
  it("BambooHR returns a real payload", async () => {
    const jobs = await new BambooHRAdapter(TIMEOUT).fetch("walmart");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]?.source).toBe("bamboohr");
    expect(jobs.some((j) => j.department)).toBe(true);
  });

  it("BambooHR unknown tenant returns HTML, not a crash", async () => {
    const adapter = new BambooHRAdapter(TIMEOUT);
    await expect(adapter.fetch("definitelynotatenant123")).rejects.toBeInstanceOf(HttpError);
    expect(await adapter.isValidSlug("definitelynotatenant123")).toBe(false);
  });

  it("Ashby quotes the CAD tier for a Canada role", async () => {
    const jobs = await new AshbyAdapter(TIMEOUT).fetch("cohere");
    const canada = jobs.filter((j) => j.title.includes("ML Workload Platform") && j.compensation);
    expect(canada.length).toBeGreaterThan(0);
    expect(canada[0]?.compensation).toContain("CA$");
    expect(canada[0]?.compensation).not.toContain("$175K");
  });

  it("Ashby quotes USD for US roles", async () => {
    const jobs = await new AshbyAdapter(TIMEOUT).fetch("cohere");
    const us = jobs.filter(
      (j) => ["San Francisco", "New York", "United States"].includes(j.location.trim()) && j.compensation,
    );
    expect(us.length).toBeGreaterThan(0);
    expect(us.filter((j) => (j.compensation ?? "").includes("CA$"))).toHaveLength(0);
  });
});

describe("discovery", () => {
  it.each([
    ["Stripe", "greenhouse"],
    ["Notion", "ashby"],
    ["Sodexo", "smartrecruiters"],
  ])("finds a live board for %s", async (company, ats) => {
    const boards = await discoverBoards(company);
    expect(boards.length).toBeGreaterThan(0);
    expect(boards.map((b) => b.ats)).toContain(ats);
  });

  it.each([["General Motors"], ["International Paper"]])("rejects look-alike boards for %s", async (company) => {
    expect(await discoverBoards(company)).toEqual([]);
  });

  it("prefers the larger board when two exist", async () => {
    const boards = await discoverBoards("Ramp");
    expect(boards[0]?.ats).toBe("ashby");
    expect(boards[0]!.job_count).toBeGreaterThan(boards[boards.length - 1]!.job_count);
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
  it("filters and ranks a real search", async () => {
    const result = await runSearch(
      { ...emptyProfile(), titles: ["software engineer"], remote_only: true },
      { companies: ["Stripe"], maxCompanies: 1 },
    );
    expect(result.boards.length).toBeGreaterThan(0);
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.jobs.every((j) => j.remote || j.location.toLowerCase().includes("remote"))).toBe(true);
    expect(result.jobs.every((j) => j.title.toLowerCase().includes("engineer"))).toBe(true);
    expect(dedupeJobs(result.jobs)).toHaveLength(result.jobs.length);
  });

  it("offers boolean site queries", async () => {
    const result = await runSearch({ ...emptyProfile(), titles: ["chief of staff"] }, { companies: ["Stripe"] });
    const matches = result.queries.filter((q) => q.startsWith("site:jobs.ashbyhq.com"));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toContain('"CoS"');
  });

  it("check reports live roles and departments", async () => {
    const result = await checkHiring(["Stripe"]);
    const signal = result.signals[0]!;
    expect(signal.unknown).toBe(false);
    expect(signal.open_roles).toBeGreaterThan(100);
    expect(signal.top_departments.length).toBeGreaterThan(0);
    expect(signal.board_count).toBeGreaterThanOrEqual(1);
  });

  it("check marks an enterprise as unknown and suggests a query", async () => {
    const result = await checkHiring(["Amazon"]);
    expect(result.signals[0]?.unknown).toBe(true);
    expect(result.queries.some((q) => q.includes("Amazon"))).toBe(true);
  });
});
