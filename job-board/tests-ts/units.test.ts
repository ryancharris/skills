/**
 * Unit tests for pure logic: models, hiring signal, discovery, filtering, output.
 *
 * Ported from tests/test_units.py. Assertions mirror the Python suite so that a
 * behavioural drift in either implementation is visible.
 */

import { describe, expect, it } from "vitest";

import { ashbyPayForLocation } from "../src/ats.js";
import { fold, slugCandidates, boardBelongsTo } from "../src/discovery.js";
import {
  buildDiscoveryQuery,
  buildSiteQuery,
  expandTitles,
  filterJobs,
  matches,
  rankJobs,
  titleContains,
} from "../src/filtering.js";
import { displayCompany, friendlyDepartment, summarizeHiring, verdict } from "../src/hiring-signal.js";
import { daysSince, makeJob, parseIso, type Board, type Job, emptyProfile } from "../src/models.js";
import { dedupeJobs, toHiringJson, toHiringMarkdown, toJson, toMarkdown } from "../src/output.js";

// Truthy for a fixed instant so date maths is deterministic.
const NOW = new Date("2026-11-09T12:00:00Z");

const job = (title = "Software Engineer", extra: Partial<Job> = {}): Job =>
  makeJob({ title, company: "Acme", url: "https://x", source: "greenhouse", ...extra });

// ------------------------------------------------------------------ models

describe("parseIso", () => {
  it("lands a date-only value at UTC midnight", () => {
    expect(parseIso("2026-11-03")?.toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });

  it("converts Z to UTC", () => {
    expect(parseIso("2026-11-03T10:42:09Z")?.toISOString()).toBe("2026-11-03T10:42:09.000Z");
  });

  it("preserves the instant for a source offset", () => {
    expect(parseIso("2026-11-03T10:42:09-04:00")?.toISOString()).toBe("2026-11-03T14:42:09.000Z");
  });

  it.each([null, undefined, "", "not-a-date", "2026-13-45"])("never throws for %p", (value) => {
    expect(parseIso(value as string | null | undefined)).toBeNull();
  });
});

describe("daysSince", () => {
  it("floors at zero for future timestamps", () => {
    expect(daysSince(new Date("2027-01-01T00:00:00Z"), NOW)).toBe(0);
  });

  it("counts whole days", () => {
    expect(daysSince(new Date("2026-11-07T12:00:00Z"), NOW)).toBe(2);
  });
});

// -------------------------------------------------------- hiring signal

const jobsOf = (specs: Array<[string, string, string | null]>): Job[] =>
  specs.map(([title, department, posted]) =>
    makeJob({
      title,
      company: "Acme",
      url: `https://x/${title}`,
      source: "greenhouse",
      department,
      posted_at: posted,
    }),
  );

const fresh = (): string => new Date(NOW.getTime() - 86_400_000).toISOString();

describe("summarizeHiring", () => {
  it("counts roles and departments", () => {
    const jobs = jobsOf([
      ["Eng 1", "Engineering", fresh()],
      ["Eng 2", "Engineering", fresh()],
      ["Sales 1", "Sales", fresh()],
    ]);
    const signal = summarizeHiring("Acme", [{ company: "Acme", ats: "greenhouse", slug: "acme", job_count: 3, url: "" }], jobs, { now: NOW });

    expect(signal.open_roles).toBe(3);
    expect(signal.board_count).toBe(1);
    expect(signal.top_departments).toEqual([
      { department: "Engineering", open_roles: 2 },
      { department: "Sales", open_roles: 1 },
    ]);
    expect(signal.hiring_recently).toBe(true);
  });

  it("groups a missing department as unspecified so totals reconcile", () => {
    const signal = summarizeHiring("Acme", [{ company: "Acme", ats: "ashby", slug: "acme", job_count: 2, url: "" }], jobsOf([["A", "", null], ["B", "", null]]));
    expect(signal.open_roles).toBe(2);
    expect(signal.top_departments).toEqual([{ department: "unspecified", open_roles: 2 }]);
  });

  it("marks stale boards as not hiring recently", () => {
    const old = new Date(NOW.getTime() - 400 * 86_400_000).toISOString();
    const signal = summarizeHiring("Acme", [{ company: "Acme", ats: "greenhouse", slug: "acme", job_count: 1, url: "" }], jobsOf([["Eng", "Eng", old]]), { now: NOW });
    expect(signal.hiring_recently).toBe(false);
    expect(signal.recent_roles).toBe(0);
  });

  it("is unknown when no board resolves", () => {
    const signal = summarizeHiring("Amazon", [], []);
    expect(signal.unknown).toBe(true);
    expect(signal.open_roles).toBe(0);
    expect(verdict(signal)).toContain("no job board found");
  });

  it("keeps a live board that simply has no postings as unknown-but-reported", () => {
    const signal = summarizeHiring("Acme", [{ company: "Acme", ats: "ashby", slug: "acme", job_count: 5, url: "" }], []);
    expect(signal.board_count).toBe(1);
    expect(signal.open_roles).toBe(0);
    expect(verdict(signal)).toBeTruthy();
  });

  it("is not partial when counts match", () => {
    const jobs = jobsOf([["A", "Eng", fresh()], ["B", "Eng", fresh()]]);
    const signal = summarizeHiring("Acme", [{ company: "Acme", ats: "ashby", slug: "acme", job_count: 2, url: "" }], jobs, { now: NOW });
    expect(signal.open_roles).toBe(2);
    expect(signal.board_reported_roles).toBe(2);
    expect(verdict(signal)).not.toContain("at least");
  });

  it("says 'at least' when the board reports more than was read", () => {
    const signal = summarizeHiring("Acme", [{ company: "Acme", ats: "smartrecruiters", slug: "acme", job_count: 155, url: "" }], jobsOf([["A", "Eng", fresh()]]), { now: NOW });
    const text = verdict(signal);
    expect(text).toContain("at least");
    expect(text).toContain("155");
  });

  it("mentions top areas in the verdict", () => {
    const signal = summarizeHiring("Acme", [{ company: "Acme", ats: "ashby", slug: "acme", job_count: 1, url: "" }], jobsOf([["Eng", "Engineering", fresh()]]), { now: NOW });
    expect(verdict(signal)).toContain("1 open role");
    expect(verdict(signal)).toContain("Engineering");
  });
});

describe("display helpers", () => {
  it("title-cases an all-lowercase slug", () => {
    expect(displayCompany("notion")).toBe("Notion");
  });
  it("leaves mixed case alone", () => {
    expect(displayCompany("Cohere")).toBe("Cohere");
    expect(displayCompany("ACME Corp")).toBe("ACME Corp");
  });
  it("expands vendor jargon", () => {
    expect(friendlyDepartment("GTM")).toBe("Sales & Marketing");
    expect(friendlyDepartment("unspecified")).toBe("Other / unlabelled");
    expect(friendlyDepartment("Engineering")).toBe("Engineering");
  });
});

// ------------------------------------------------------------- discovery

describe("slugCandidates", () => {
  it.each([
    ["Stripe", "stripe"],
    ["Meta Platforms", "metaplatforms"],
    ["Cisco Systems, Inc.", "ciscosystems"],
    ["The Boeing Company", "boeing"],
  ])("%s -> %s first", (name, first) => {
    const candidates = slugCandidates(name);
    expect(candidates[0]).toBe(first);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("returns nothing for blank input", () => {
    expect(slugCandidates("   ")).toEqual([]);
  });

  it("folds diacritics to ASCII slugs", () => {
    const candidates = slugCandidates("Société Générale");
    expect(candidates[0]).toBe("societegenerale");
    expect(candidates).toContain("societe");
    expect(candidates.every((c) => /^[\x00-\x7F]*$/.test(c))).toBe(true);
  });

  it("fold strips combining marks", () => {
    expect(fold("Société")).toBe("Societe");
  });
});

describe("boardBelongsTo", () => {
  const adapter = (actual: string | null) =>
    ({ boardCompany: () => actual }) as unknown as Parameters<typeof boardBelongsTo>[1];

  it.each([
    ["Stripe", "Stripe", true],
    ["Meta Platforms", "Meta", true],
    ["Cisco Systems, Inc.", "Cisco", true],
    ["Sodexo", "Sodexo", true],
    ["General Motors", "General Interest", false],
    ["International Paper", "UpWork International", false],
    ["Anything", null, true],
  ])("%s vs %s -> %s", (query, actual, expected) => {
    expect(boardBelongsTo(query, adapter(actual), "slug")).toBe(expected);
  });
});

// ------------------------------------------------------------- filtering

describe("expandTitles", () => {
  it("adds synonyms", () => {
    const groups = expandTitles(["chief of staff"]);
    expect(groups[0]?.[0]).toBe("chief of staff");
    expect(groups[0]).toContain("CoS");
  });

  it("leaves an unknown title alone", () => {
    expect(expandTitles(["astronaut"])).toEqual([["astronaut"]]);
  });
});

describe("buildSiteQuery", () => {
  it("reproduces the source post's example", () => {
    expect(buildSiteQuery("jobs.ashbyhq.com", expandTitles(["chief of staff"]))).toBe(
      'site:jobs.ashbyhq.com ("chief of staff" OR "CoS" OR "chief of staff to CEO")',
    );
  });

  it("emits one site: per query with multiple OR groups", () => {
    const query = buildSiteQuery("boards.greenhouse.io", expandTitles(["data scientist", "software engineer"]));
    expect(query.split("site:").length - 1).toBe(1);
    expect(query.split("(").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("builds a discovery query", () => {
    expect(buildDiscoveryQuery("Acme")).toContain("greenhouse");
  });
});

describe("titleContains", () => {
  it.each([
    ["Senior PM", "PM", true],
    ["PM, Growth", "PM", true],
    ["Business Development Representative", "PM", false],
    ["Partner Development Manager", "PM", false],
    // "CoS" is a synonym, not a literal substring of the spelled-out title;
    // the synonym expands the SEARCH, it does not match this string.
    ["Chief of Staff to CEO", "CoS", false],
    ["CoS, Growth", "CoS", true],
    ["Engineer", "engineer", true],
  ])("%s contains %s -> %s", (title, term, expected) => {
    expect(titleContains(title, term)).toBe(expected);
  });
});

describe("filtering", () => {
  it("matches title synonyms", () => {
    const jobs = [job("Chief of Staff to CEO"), job("Accountant")];
    expect(filterJobs(jobs, { ...emptyProfile(), titles: ["chief of staff"] }).map((j) => j.title)).toEqual([
      "Chief of Staff to CEO",
    ]);
  });

  it("excludes development roles from a product manager search", () => {
    const jobs = [
      job("Business Development Representative"),
      job("Partner Development Manager"),
      job("Product Manager, Terminal Payments"),
      job("Senior PM"),
    ];
    const titles = filterJobs(jobs, { ...emptyProfile(), titles: ["product manager"] }).map((j) => j.title);
    expect(titles).toContain("Product Manager, Terminal Payments");
    expect(titles).toContain("Senior PM");
    expect(titles).not.toContain("Business Development Representative");
    expect(titles).not.toContain("Partner Development Manager");
  });

  it("filters remote only", () => {
    const jobs = [job("A", { location: "Remote - US", remote: true }), job("B", { location: "Dublin" })];
    expect(filterJobs(jobs, { ...emptyProfile(), remote_only: true })).toHaveLength(1);
  });

  it("filters by location", () => {
    const jobs = [job("A", { location: "New York, NY" }), job("B", { location: "Dublin" })];
    expect(filterJobs(jobs, { ...emptyProfile(), locations: ["new york"] }).map((j) => j.location)).toEqual([
      "New York, NY",
    ]);
  });

  it("applies seniority on word boundaries", () => {
    const jobs = [job("Senior Engineer"), job("Engineer II"), job("Intern")];
    const titles = filterJobs(jobs, { ...emptyProfile(), seniority: ["senior"] }).map((j) => j.title);
    expect(titles).toContain("Senior Engineer");
    expect(titles).not.toContain("Intern");
  });

  it("does not match 'director' inside an unrelated word", () => {
    const jobs = [job("Director of Engineering"), job("Monitoring Engineer")];
    expect(filterJobs(jobs, { ...emptyProfile(), seniority: ["director"] }).map((j) => j.title)).toEqual([
      "Director of Engineering",
    ]);
  });

  it("excludes keywords and companies", () => {
    const jobs = [job("Engineer", { company: "Meta" }), job("Engineer (Contract)")];
    expect(filterJobs(jobs, { ...emptyProfile(), exclude_keywords: ["contract"] })).toHaveLength(1);
    expect(filterJobs(jobs, { ...emptyProfile(), exclude_companies: ["meta"] })[0]?.company).toBe("Acme");
  });

  it("filters by max age", () => {
    const freshJob = job("A", { posted_at: new Date(NOW.getTime() - 2 * 86_400_000).toISOString() });
    const staleJob = job("B", { posted_at: new Date(NOW.getTime() - 400 * 86_400_000).toISOString() });
    const got = filterJobs([freshJob, staleJob], { ...emptyProfile(), max_age_days: 30 }, NOW);
    expect(got).toEqual([freshJob]);
  });

  it("requires every include keyword", () => {
    const jobs = [job("Backend Engineer, Go"), job("Backend Engineer, Python")];
    expect(filterJobs(jobs, { ...emptyProfile(), include_keywords: ["backend", "go"] })).toHaveLength(1);
  });

  it("matches keywords on word boundaries", () => {
    expect(matches(job("Backend Engineer", { department: "MongoDB" }), { ...emptyProfile(), include_keywords: ["go"] })).toBe(false);
    expect(matches(job("Engineer", { department: "Retail" }), { ...emptyProfile(), include_keywords: ["ai"] })).toBe(false);
    expect(matches(job("Backend Engineer, Go"), { ...emptyProfile(), include_keywords: ["go"] })).toBe(true);
  });

  it("matches multiword keyword phrases", () => {
    expect(matches(job("Machine Learning Engineer"), { ...emptyProfile(), include_keywords: ["machine learning"] })).toBe(true);
  });

  it("keeps everything when unconstrained", () => {
    expect(matches(job(), emptyProfile())).toBe(true);
  });
});

describe("rankJobs", () => {
  it("prefers a title match over recency", () => {
    const strongOld = job("Software Engineer", { posted_at: new Date(NOW.getTime() - 50 * 86_400_000).toISOString() });
    const weakNew = job("Accountant", { posted_at: new Date(NOW.getTime() - 86_400_000).toISOString() });
    expect(rankJobs([weakNew, strongOld], { ...emptyProfile(), titles: ["software engineer"] }, NOW)[0]?.title).toBe(
      "Software Engineer",
    );
  });

  it("tie-breaks by recency", () => {
    const old = job("Software Engineer", { posted_at: new Date(NOW.getTime() - 90 * 86_400_000).toISOString() });
    const freshJob = job("Software Engineer", { posted_at: new Date(NOW.getTime() - 86_400_000).toISOString() });
    expect(rankJobs([old, freshJob], emptyProfile(), NOW)[0]).toBe(freshJob);
  });

  it("handles an empty list", () => {
    expect(rankJobs([], emptyProfile())).toEqual([]);
  });
});

// ---------------------------------------------------------------- output

describe("dedupeJobs", () => {
  it("collapses a cross-source repost", () => {
    const a = job("Engineer", { company: "Acme", location: "NYC", url: "https://a" });
    const b = job("engineer", { company: "acme", location: "nyc", url: "https://b" });
    expect(dedupeJobs([a, b])).toHaveLength(1);
  });

  it("keeps distinct requisitions on the same board", () => {
    const a = job("Software Engineer", { location: "Seattle, WA", identifier: "8267736", url: "https://x/1" });
    const b = job("Software Engineer", { location: "Seattle, WA", identifier: "8249901", url: "https://x/2" });
    expect(dedupeJobs([a, b])).toHaveLength(2);
  });

  it("collapses an identical same-source record", () => {
    const a = job("X", { location: "NYC", identifier: "1", url: "https://x/1" });
    const b = job("X", { location: "NYC", identifier: "1", url: "https://x/1" });
    expect(dedupeJobs([a, b])).toHaveLength(1);
  });

  it("prefers the origin board across sources", () => {
    const gh = job("Engineer", { company: "Acme", location: "NYC", source: "greenhouse", url: "https://x/1" });
    const sr = job("Engineer", { company: "Acme", location: "NYC", source: "search", url: "https://y/2" });
    const out = dedupeJobs([gh, sr]);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe("greenhouse");
  });

  it("prefers a dated record across sources", () => {
    const noDate = job("Engineer", { location: "NYC", source: "search", url: "https://a" });
    const dated = job("Engineer", { location: "NYC", source: "greenhouse", url: "https://b", posted_at: "2026-01-01T00:00:00Z" });
    const out = dedupeJobs([noDate, dated]);
    expect(out).toHaveLength(1);
    expect(out[0]?.posted_at).toBe("2026-01-01T00:00:00Z");
    expect(out[0]?.source).toBe("greenhouse");
  });

  it("collapses same-source records without ids", () => {
    const a = job("Engineer", { location: "NYC", url: "https://a" });
    const b = job("Engineer", { location: "NYC", url: "https://b" });
    expect(dedupeJobs([a, b])).toHaveLength(1);
  });
});

describe("toJson", () => {
  it("has the expected shape", () => {
    const payload = JSON.parse(toJson([job()], { boards: [{ company: "Acme", ats: "greenhouse", slug: "acme", job_count: 3, url: "" }], meta: { k: "v" } }));
    expect(payload.count).toBe(1);
    expect(payload.meta).toEqual({ k: "v" });
    expect(payload.boards[0].slug).toBe("acme");
    expect(payload.jobs[0].title).toBe("Software Engineer");
    expect(payload.queries).toEqual([]);
    expect(payload.warnings).toEqual([]);
  });

  it("distinguishes count from total when truncated", () => {
    const jobs = Array.from({ length: 10 }, (_, i) => job(`Engineer ${i}`));
    const payload = JSON.parse(toJson(jobs.slice(0, 3), { total: jobs.length }));
    expect(payload.count).toBe(3);
    expect(payload.total).toBe(10);
    expect(payload.truncated).toBe(true);
  });

  it("is not truncated when complete", () => {
    const payload = JSON.parse(toJson([job()], { total: 1 }));
    expect(payload.count).toBe(1);
    expect(payload.total).toBe(1);
    expect(payload.truncated).toBe(false);
  });

  it("emits job keys in canonical order", () => {
    const payload = JSON.parse(toJson([job()]));
    expect(Object.keys(payload.jobs[0])).toEqual([
      "title", "company", "url", "source", "location", "remote",
      "department", "employment_type", "posted_at", "compensation",
      "identifier", "snippet",
    ]);
  });

  it("drops redundant and empty fields in compact mode", () => {
    const source = job("Engineer", { location: "NYC", identifier: "abc123" });
    const full = JSON.parse(toJson([source])).jobs[0];
    const compact = JSON.parse(toJson([source], { compact: true })).jobs[0];
    expect(full.identifier).toBe("abc123");
    expect(compact.identifier).toBeUndefined();
    expect(compact.snippet).toBeUndefined();
    for (const key of ["title", "company", "url", "location", "source"]) {
      expect(compact[key]).toBe(full[key]);
    }
  });
});

describe("toMarkdown", () => {
  it("renders a link and leads with jobs", () => {
    const md = toMarkdown([job("Software Engineer", { url: "https://x/1" })], {
      boards: [{ company: "Acme", ats: "greenhouse", slug: "acme", job_count: 3, url: "" }],
    });
    expect(md).toContain("[Software Engineer](https://x/1)");
    expect(md).toContain("# 1 role at Acme");
    expect(md).toContain("Diagnostics");
    expect(md.indexOf("Software Engineer")).toBeLessThan(md.indexOf("Diagnostics"));
  });

  it("renders an empty state", () => {
    expect(toMarkdown([])).toContain("No postings matched");
  });
});

describe("hiring JSON/Markdown", () => {
  const oneBoard: Board[] = [{ company: "Acme", ats: "ashby", slug: "acme", job_count: 1, url: "" }];

  it("hiring JSON shape", () => {
    const signal = summarizeHiring("Acme", oneBoard, jobsOf([["Eng", "Eng", null]]));
    const payload = JSON.parse(toHiringJson([signal], { queries: ["q"], warnings: ["w"] }));
    expect(payload.count).toBe(1);
    expect(payload.signals[0].company).toBe("Acme");
    expect(payload.queries).toEqual(["q"]);
    expect(payload.warnings).toEqual(["w"]);
    expect(payload.truncated).toBe(false);
  });

  it("hiring Markdown renders table and verdict", () => {
    const signal = summarizeHiring("Acme", oneBoard, jobsOf([["Eng", "Engineering", null]]));
    const md = toHiringMarkdown([signal], ["discover acme"]);
    expect(md).toContain("## Acme");
    expect(md).toContain("| Engineering | 1 |");
    expect(md).toContain("discover acme");
  });

  it("surfaces the first query as a next step", () => {
    const signal = summarizeHiring("Google", [], []);
    const md = toHiringMarkdown([signal], ["first-query", "second-query"]);
    expect(md).toContain("find the careers page yourself");
    expect(md).toContain("> first-query");
    expect(md).toContain("second-query");
  });

  it("omits the next-step block when resolved", () => {
    const signal = summarizeHiring("Acme", oneBoard, jobsOf([["Eng", "Eng", null]]));
    expect(toHiringMarkdown([signal], [])).not.toContain("find the careers page yourself");
  });

  it("renders an empty state", () => {
    expect(toHiringMarkdown([])).toContain("No companies checked");
  });
});

// ------------------------------------------------------- Ashby pay tiers

describe("ashbyPayForLocation", () => {
  const tiers = {
    compensationTierSummary: "S",
    compensationTiers: [
      { tierSummary: "CA$1", components: [{ compensationType: "Salary", currencyCode: "CAD" }] },
      { tierSummary: "$1", components: [{ compensationType: "Salary", currencyCode: "USD" }] },
    ],
  };

  it("picks the CAD tier for a Canada role", () => {
    expect(ashbyPayForLocation(tiers, "Canada")).toBe("CA$1");
    expect(ashbyPayForLocation(tiers, "Toronto")).toBe("CA$1");
  });

  it("picks the USD tier for a US role", () => {
    expect(ashbyPayForLocation(tiers, "San Francisco")).toBe("$1");
    expect(ashbyPayForLocation(tiers, "United States")).toBe("$1");
  });

  it("never throws on absent compensation and does not regress", () => {
    expect(ashbyPayForLocation(null, "Canada")).toBeNull();
    expect(ashbyPayForLocation({}, "Canada")).toBeNull();
    expect(ashbyPayForLocation({ compensationTierSummary: "X" }, "Canada")).toBe("X");
    expect(ashbyPayForLocation(tiers, "Atlantis")).toBe("S");
  });
});

// ------------------------------------------------- empty-state explanations

describe("empty-state messages", () => {
  it("explains a missing API key instead of blaming the filters", () => {
    // The old text said "try widening titles", which no title could fix: the
    // company has no readable board AND the fallback had no key.
    const md = toMarkdown([], {
      emptyReason: {
        kind: "no_key",
        provider: "kagi",
        variable: "JOB_BOARD_SEARCH_API_KEY",
        companies: ["Amazon"],
      },
    });
    expect(md).toContain("No roles found for **Amazon**");
    expect(md).toContain("cannot read directly");
    expect(md).toContain("JOB_BOARD_SEARCH_API_KEY");
    expect(md).toContain("provider: kagi");
    expect(md).not.toContain("widening titles");
  });

  it("pluralises when several companies are involved", () => {
    const md = toMarkdown([], {
      emptyReason: {
        kind: "no_key",
        provider: "brave",
        variable: "JOB_BOARD_SEARCH_API_KEY",
        companies: ["Amazon", "Google"],
      },
    });
    expect(md).toContain("No roles found for **Amazon, Google**");
    expect(md).toContain("These companies use");
    expect(md).toContain("provider: brave");
  });

  it("explains a no-board result", () => {
    const md = toMarkdown([], {
      emptyReason: { kind: "no_board", companies: ["Acme"] },
    });
    expect(md).toContain("No job board found for Acme");
    expect(md).toContain("JOB_BOARD_SEARCH_API_KEY");
  });

  it("explains a filtered-out result with the real count", () => {
    const md = toMarkdown([], { emptyReason: { kind: "filtered", raw: 124 } });
    expect(md).toContain("124 open roles were found");
    expect(md).toContain("--title");
  });

  it("falls back to generic advice when no reason is known", () => {
    expect(toMarkdown([])).toContain("No postings matched");
  });
});

describe("empty_reason in JSON", () => {
  it("is null when there are jobs", () => {
    const payload = JSON.parse(toJson([job()]));
    expect(payload.empty_reason).toBeNull();
  });

  it("carries the structured cause for an agent", () => {
    const payload = JSON.parse(
      toJson([], {
        emptyReason: {
          kind: "no_key",
          provider: "kagi",
          variable: "JOB_BOARD_SEARCH_API_KEY",
          companies: ["Amazon"],
        },
      }),
    );
    expect(payload.empty_reason.kind).toBe("no_key");
    expect(payload.empty_reason.variable).toBe("JOB_BOARD_SEARCH_API_KEY");
  });
});
