/**
 * Partial results: a SmartRecruiters board larger than the 1,000-posting read
 * limit must be reported as partial in role search, not silently cut short.
 *
 * The HTTP layer is replaced by a synthetic board, so nothing touches the
 * network (the suite's network guard would reject it anyway).
 */

import { describe, expect, it } from "vitest";

import { SmartRecruitersAdapter, type BoardRead } from "../src/ats.js";
import { renderJobs } from "../src/cli.js";
import { toDetail } from "../src/format-detail.js";
import { toHtml } from "../src/format-html.js";
import { boardKey, partialBoards } from "../src/pipeline.js";
import { toJson, toMarkdown } from "../src/output.js";
import { summarizeHiring, verdict } from "../src/hiring-signal.js";
import { makeJob, type Board, type Job, type PartialBoard } from "../src/models.js";

/** A SmartRecruiters adapter serving a synthetic board of `totalFound` postings. */
class FakeSmartRecruiters extends SmartRecruitersAdapter {
  calls = 0;

  constructor(private readonly totalFound: number) {
    super();
  }

  protected override async get(url: string): Promise<Record<string, unknown>> {
    this.calls++;
    const params = new URL(url).searchParams;
    const offset = Number(params.get("offset") ?? "0");
    const limit = Number(params.get("limit") ?? "100");
    const n = Math.max(0, Math.min(limit, this.totalFound - offset));
    const content = Array.from({ length: n }, (_, i) => ({
      id: String(offset + i),
      name: `Role ${offset + i}`,
      location: {},
      company: { name: "Acme" },
    }));
    return { totalFound: this.totalFound, content };
  }
}

const job = (id: string): Job =>
  makeJob({
    title: `Role ${id}`,
    company: "Acme",
    url: `https://jobs.smartrecruiters.com/acme/${id}`,
    source: "smartrecruiters",
    identifier: id,
  });

const board = (job_count: number): Board => ({
  company: "Acme",
  ats: "smartrecruiters",
  slug: "acme",
  job_count,
  url: "",
});

const readOf = (jobs: number, reported: number | null): BoardRead => ({
  jobs: Array.from({ length: jobs }, (_, i) => job(String(i))),
  reported,
});

const PARTIAL: PartialBoard = { company: "Acme", ats: "smartrecruiters", read: 1000, reported: 1500 };

function opts(partial: PartialBoard[] = []) {
  return {
    boards: [board(1500)],
    meta: {},
    queries: [],
    warnings: [],
    limit: null,
    emptyReason: null,
    partialBoards: partial,
  } as Parameters<typeof renderJobs>[2];
}

describe("SmartRecruiters read: postings plus the board's own total", () => {
  it("reads a board that fits under the cap in full, reporting it complete", async () => {
    const read = await new FakeSmartRecruiters(250).fetchRead("acme");
    expect(read.jobs).toHaveLength(250);
    expect(read.reported).toBe(250);
  });

  it("stops at the 10-page cap and reports the larger total", async () => {
    const adapter = new FakeSmartRecruiters(1500);
    const read = await adapter.fetchRead("acme");
    expect(read.jobs).toHaveLength(1000);
    expect(read.reported).toBe(1500);
    expect(adapter.calls).toBe(10);
  });

  it("a board of exactly the cap is complete, not partial", async () => {
    const read = await new FakeSmartRecruiters(1000).fetchRead("acme");
    expect(read.jobs).toHaveLength(1000);
    expect(read.reported).toBe(1000);
  });

  it("fetch() still returns only the postings, unchanged for other callers", async () => {
    const jobs = await new FakeSmartRecruiters(1500).fetch("acme");
    expect(jobs).toHaveLength(1000);
  });

  it("an empty board reports zero postings", async () => {
    const read = await new FakeSmartRecruiters(0).fetchRead("acme");
    expect(read).toEqual({ jobs: [], reported: 0 });
  });
});

describe("partialBoards: which boards were read incompletely", () => {
  const b = board(1500);

  it("flags a board whose total exceeds what was read", () => {
    const reads = new Map([[boardKey(b), readOf(1000, 1500)]]);
    expect(partialBoards([b], reads)).toEqual([PARTIAL]);
  });

  it("does not flag a complete board", () => {
    const reads = new Map([[boardKey(b), readOf(1500, 1500)]]);
    expect(partialBoards([b], reads)).toEqual([]);
  });

  it("does not flag a board that reports no total", () => {
    const reads = new Map([[boardKey(b), readOf(1000, null)]]);
    expect(partialBoards([b], reads)).toEqual([]);
  });

  it("does not flag a board whose read failed (already warned about)", () => {
    const reads = new Map([[boardKey(b), { jobs: [], reported: null }]]);
    expect(partialBoards([b], reads)).toEqual([]);
  });

  it("ignores a board with no read at all", () => {
    expect(partialBoards([b], new Map())).toEqual([]);
  });
});

describe("JSON output carries the partial state", () => {
  it("sets partial and lists the boards when a board was cut short", () => {
    const payload = JSON.parse(toJson([job("1")], { partialBoards: [PARTIAL] }));
    expect(payload.partial).toBe(true);
    expect(payload.partial_boards).toEqual([PARTIAL]);
  });

  it("is false with an empty list when every board was read in full", () => {
    const payload = JSON.parse(toJson([job("1")]));
    expect(payload.partial).toBe(false);
    expect(payload.partial_boards).toEqual([]);
  });

  it("is present in the compact format too", () => {
    const payload = JSON.parse(renderJobs([job("1")], "json-compact", opts([PARTIAL])));
    expect(payload.partial).toBe(true);
  });

  it("stays free of emoji", () => {
    const out = renderJobs([job("1")], "json", opts([PARTIAL]));
    expect(/\p{Extended_Pictographic}/u.test(out)).toBe(false);
  });

  it("keeps truncated separate from partial (truncated means --limit cut the list)", () => {
    const payload = JSON.parse(toJson([job("1")], { partialBoards: [PARTIAL], total: 1 }));
    expect(payload.truncated).toBe(false);
    expect(payload.partial).toBe(true);
  });
});

describe("human formats show the partial line", () => {
  const LINE = "Partial: Acme's smartrecruiters board has 1500 postings but only 1000 were read";

  it("markdown", () => {
    expect(toMarkdown([job("1")], { partialBoards: [PARTIAL] })).toContain(LINE);
    expect(toMarkdown([job("1")], {})).not.toContain("Partial:");
  });

  it("detail", () => {
    expect(toDetail([job("1")], { partialBoards: [PARTIAL] })).toContain(LINE);
    expect(toDetail([job("1")], {})).not.toContain("Partial:");
  });

  it("html (escaped, so the apostrophe is an entity, not a raw quote)", () => {
    const html = toHtml([job("1")], { partialBoards: [PARTIAL] });
    expect(html).toContain("Partial: Acme");
    expect(html).toContain("only 1000 were read");
    expect(toHtml([job("1")], {})).not.toContain("Partial:");
  });
});

describe("--check verdict states the read count, not a page count", () => {
  it("says how many were read out of the board total", () => {
    const postings = Array.from({ length: 1000 }, (_, i) => job(String(i)));
    const signal = summarizeHiring("Acme", [board(1500)], postings, { recentDays: 30 });
    expect(verdict(signal)).toContain("at least 1000 open roles (1500 total; 1000 read)");
    expect(verdict(signal)).not.toContain("first page");
  });
});
