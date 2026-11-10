/**
 * Tests for the human-facing formats: detail blocks and HTML.
 *
 * The JSON formats are covered elsewhere and their key set is a contract; here
 * the focus is that emoji stay out of machine output, that HTML is escaped and
 * self-contained, and that both formats degrade sensibly when a result is empty.
 */

import { describe, expect, it } from "vitest";

import { FORMATS, renderJobs } from "../src/cli.js";
import { SYMBOLS, ageLabel, jobBadges, toDetail } from "../src/format-detail.js";
import { escapeHtml, toHtml } from "../src/format-html.js";
import { makeJob, type Job } from "../src/models.js";

const NOW = new Date("2026-11-09T12:00:00Z");
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

const job = (extra: Partial<Job> = {}): Job =>
  makeJob({
    title: "Infrastructure Engineer",
    company: "openai",
    url: "https://jobs.ashbyhq.com/openai/abc",
    source: "ashby",
    location: "US - Remote",
    remote: true,
    department: "Security",
    employment_type: "FullTime",
    posted_at: daysAgo(3),
    compensation: "$266K – $445K",
    ...extra,
  });

const EMPTY_OPTS = {
  boards: [],
  meta: {},
  queries: [],
  warnings: [],
  limit: null,
  emptyReason: null,
};

describe("format registry", () => {
  it("marks only the JSON formats as agent-facing", () => {
    expect(FORMATS.json?.agent).toBe(true);
    expect(FORMATS["json-compact"]?.agent).toBe(true);
    for (const name of ["md", "detail", "html"]) {
      expect(FORMATS[name]?.agent, `${name} should be human-facing`).toBe(false);
    }
  });

  it("every registered format renders without throwing", () => {
    for (const name of Object.keys(FORMATS)) {
      expect(() => renderJobs([job()], name, EMPTY_OPTS), name).not.toThrow();
    }
  });
});

describe("emoji never leak into agent formats", () => {
  it.each(["json", "json-compact"])("%s contains no emoji", (format) => {
    const out = renderJobs([job()], format, EMPTY_OPTS);
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it.each(["detail", "html"])("%s does use emoji", (format) => {
    const out = renderJobs([job()], format, EMPTY_OPTS);
    expect(out).toContain(SYMBOLS.remote);
  });
});

describe("jobBadges", () => {
  it("marks remote, pay, and freshness together", () => {
    expect(jobBadges(job(), NOW)).toEqual([SYMBOLS.remote, SYMBOLS.salary, SYMBOLS.fresh]);
  });

  it("marks a stale posting instead of fresh", () => {
    expect(jobBadges(job({ posted_at: daysAgo(400) }), NOW)).toContain(SYMBOLS.stale);
    expect(jobBadges(job({ posted_at: daysAgo(400) }), NOW)).not.toContain(SYMBOLS.fresh);
  });

  it("omits unknown signals rather than guessing", () => {
    const bare = job({ remote: false, compensation: null, posted_at: null });
    expect(jobBadges(bare, NOW)).toEqual([]);
  });
});

describe("ageLabel", () => {
  it.each([
    [0, "today"],
    [1, "yesterday"],
    [3, "3d ago"],
    [45, "1mo ago"],
    [400, "1y ago"],
  ])("%i days -> %s", (days, expected) => {
    expect(ageLabel(job({ posted_at: daysAgo(days) }), NOW)).toBe(expected);
  });

  it("is null when the date is unknown", () => {
    expect(ageLabel(job({ posted_at: null }), NOW)).toBeNull();
  });
});

describe("toDetail", () => {
  it("gives each finding its own block with a copyable link", () => {
    const out = toDetail([job(), job({ url: "https://x/2", title: "Second" })]);
    expect(out.match(/─{10,}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(out).toContain("🔗 https://jobs.ashbyhq.com/openai/abc");
    expect(out).toContain("**Company:** OpenAI");
    expect(out).toContain("**Pay:** $266K – $445K");
  });

  it("shows the pay emoji only once per finding", () => {
    const out = toDetail([job({ compensation: "$100K" })]);
    expect(out.split(SYMBOLS.salary).length - 1).toBeLessThanOrEqual(2); // badge + legend
  });

  it("explains an empty result rather than blaming filters", () => {
    const out = toDetail([], {
      boards: [],
      meta: {},
      limit: null,
      emptyReason: {
        kind: "no_key",
        provider: "kagi",
        variable: "LAID_OFF_SEARCH_API_KEY",
        companies: ["Amazon"],
      },
    });
    expect(out).toContain(SYMBOLS.unreadable);
    expect(out).toContain("LAID_OFF_SEARCH_API_KEY");
    expect(out).not.toContain("widening titles");
  });
});

describe("escapeHtml", () => {
  it("neutralises markup and quotes", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands in real company names", () => {
    expect(escapeHtml("Sodali & Co.")).toBe("Sodali &amp; Co.");
  });
});

describe("toHtml", () => {
  it("is a standalone document with no external requests", () => {
    const html = toHtml([job()]);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\/fonts|src=/);
  });

  it("escapes a hostile job title", () => {
    const html = toHtml([job({ title: '<img src=x onerror=alert(1)>' })]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("renders one article per finding", () => {
    const html = toHtml([job(), job({ url: "https://x/2", title: "Two" })]);
    expect(html.match(/<article class="job">/g)).toHaveLength(2);
  });

  it("explains an empty result", () => {
    const html = toHtml([], {
      emptyReason: { kind: "no_board", companies: ["Acme"] },
    });
    expect(html).toContain(SYMBOLS.unreadable);
    expect(html).toContain("Acme");
  });
});

describe("displayCompany via the formats", () => {
  it("shows brand capitalisation, not title case", () => {
    expect(toDetail([job({ company: "openai" })])).toContain("**Company:** OpenAI");
    expect(toHtml([job({ company: "openai" })])).toContain("OpenAI");
  });
});

describe("--check html", () => {
  it("emits a document, not Markdown", async () => {
    const { toHiringHtml } = await import("../src/format-html.js");
    const { summarizeHiring } = await import("../src/hiring-signal.js");
    const signal = summarizeHiring("Cohere", [
      { company: "Cohere", ats: "ashby", slug: "cohere", job_count: 5, url: "" },
    ], [job({ posted_at: daysAgo(2) })], { now: NOW });
    const html = toHiringHtml([signal]);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toContain("## Cohere");
    expect(html).toContain("Cohere");
  });

  it("marks an unreadable company distinctly", async () => {
    const { toHiringHtml } = await import("../src/format-html.js");
    const { summarizeHiring } = await import("../src/hiring-signal.js");
    const html = toHiringHtml([summarizeHiring("Amazon", [], [], { now: NOW })]);
    expect(html).toContain(SYMBOLS.unreadable);
  });
});
