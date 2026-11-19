/**
 * A role search that names several companies must say which ones it could not read.
 * Before, a company with no board vanished from the output when another company had
 * postings, and a reader took its absence for "no roles".
 * Offline: a fake adapter serves one board, "readable".
 */
import { describe, expect, it } from "vitest";

import { ATSAdapter } from "../src/ats.js";
import { renderJobs } from "../src/cli.js";
import { emptyProfile, makeJob, type Board } from "../src/models.js";
import { findUnreadable, meta, runSearch, unreadableWarning } from "../src/pipeline.js";

class Fake extends ATSAdapter {
  readonly name = "ashby";
  async fetch(slug: string, company?: string) {
    if (slug !== "readable") return [];
    return ["Software Engineer", "Account Executive"].map((title, i) =>
      makeJob({
        title,
        company: company || slug,
        url: `https://jobs.example.com/readable/${i}`,
        source: "ashby",
        location: "Remote",
      }),
    );
  }
}

const profile = { ...emptyProfile(), titles: ["software engineer"] };
const search = (companies: string[], max?: number) =>
  runSearch(profile, { companies, maxCompanies: max, adapters: [new Fake()], provider: null });

const isNotice = (w: string) => w.startsWith("Could not read a board for");

describe("unreadable_companies in a role search", () => {
  it("lists the company with no board and warns once when another was read", async () => {
    const result = await search(["Readable Co", "Zzqx Holdings"]);
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.unreadable_companies).toEqual(["Zzqx Holdings"]);
    expect(result.warnings.filter(isNotice)).toEqual([unreadableWarning(["Zzqx Holdings"])]);
    expect(result.warnings[0]).toContain("Zzqx Holdings");
    expect(result.warnings[0]).toContain("no postings from it are included");
    expect(result.warnings[0]).toContain("not the same as having no roles");
  });

  it("is empty, with no warning, when every company has a board", async () => {
    const result = await search(["Readable Co"]);
    expect(result.unreadable_companies).toEqual([]);
    expect(result.warnings.filter(isNotice)).toEqual([]);
  });

  it("lists every company when none has a board, without the mixed-run warning", async () => {
    const none = { name: "fake", search: async () => [] } as never;
    const result = await runSearch(profile, {
      companies: ["Zzqx Holdings", "Qqxz Group"],
      adapters: [new Fake()],
      provider: none,
    });
    expect(result.unreadable_companies).toEqual(["Zzqx Holdings", "Qqxz Group"]);
    expect(result.warnings.filter(isNotice)).toEqual([]);
    expect(result.empty_reason).toEqual({
      kind: "no_board",
      companies: ["Zzqx Holdings", "Qqxz Group"],
      search: "no_results",
    });
  });

  it("does not repeat the notice when the search fallback warning already names the company", async () => {
    const provider = {
      name: "fake",
      search: async () => [{ title: "Engineer at Other", url: "https://jobs.lever.co/other/1", snippet: "x" }],
    } as never;
    const result = await runSearch(profile, { companies: ["Zzqx Holdings"], adapters: [new Fake()], provider });
    expect(result.unreadable_companies).toEqual(["Zzqx Holdings"]);
    expect(result.warnings.filter(isNotice)).toEqual([]);
    expect(result.warnings.filter((w) => w.includes("Zzqx Holdings"))).toHaveLength(1);
  });

  it("keeps the order the companies were named in", async () => {
    const result = await search(["Zeta Inc", "Readable Co", "Alpha Inc", "Mid Inc"]);
    expect(result.unreadable_companies).toEqual(["Zeta Inc", "Alpha Inc", "Mid Inc"]);
    expect(result.warnings.filter(isNotice)).toHaveLength(1);
    expect(result.warnings.filter(isNotice)[0]).toContain("Zeta Inc, Alpha Inc, Mid Inc");
  });

  it("lists a repeated company once", async () => {
    const result = await search(["Readable Co", "Zzqx Holdings", "zzqx  holdings", "Zzqx Holdings"]);
    expect(result.unreadable_companies).toEqual(["Zzqx Holdings"]);
  });

  it("does not list a company cut off by --max-companies", async () => {
    const result = await search(["Readable Co", "Zzqx Holdings", "Qqxz Group"], 2);
    expect(result.unreadable_companies).toEqual(["Zzqx Holdings"]);
  });

  it("is empty when no company was given", async () => {
    const result = await search([]);
    expect(result.unreadable_companies).toEqual([]);
  });

  it("is present in the JSON, and empty when everything was read", async () => {
    const result = await search(["Readable Co"]);
    const out = JSON.parse(render(result, "json"));
    expect(out.unreadable_companies).toEqual([]);
  });
});

describe("findUnreadable", () => {
  const board = (job_count: number): Board => ({ company: "Acme", ats: "ashby", slug: "acme", job_count, url: "" });

  it("does not list a company that has a board with no postings", () => {
    const byCompany = new Map<string, Board[]>([
      ["Acme", [board(0)]],
      ["Zzqx Holdings", []],
    ]);
    expect(findUnreadable(["Acme", "Zzqx Holdings"], byCompany)).toEqual(["Zzqx Holdings"]);
  });

  it("lists a company missing from the map", () => {
    expect(findUnreadable(["Acme"], new Map())).toEqual(["Acme"]);
  });
});

function render(result: Awaited<ReturnType<typeof search>>, format: string): string {
  return renderJobs(result.jobs, format, {
    boards: result.boards,
    meta: meta(result),
    queries: result.queries,
    warnings: result.warnings,
    limit: null,
    emptyReason: result.empty_reason,
    unreadableCompanies: result.unreadable_companies,
    partialBoards: result.partial_boards,
  });
}

describe("the unreadable-company warning in every format", () => {
  const WARNING = unreadableWarning(["Zzqx Holdings"]);

  it.each(["md", "detail", "html"])("%s shows it exactly once", async (format) => {
    const result = await search(["Readable Co", "Zzqx Holdings"]);
    const text = render(result, format);
    const plain = text.replace(/&quot;/g, '"');
    expect(plain.split(WARNING).length - 1, format).toBe(1);
  });

  it.each(["json", "json-compact"])("%s carries the field and the warning", async (format) => {
    const result = await search(["Readable Co", "Zzqx Holdings"]);
    const out = JSON.parse(render(result, format));
    expect(out.unreadable_companies).toEqual(["Zzqx Holdings"]);
    expect(out.warnings).toEqual([WARNING]);
  });

  it.each(["json", "json-compact"])("%s has the field even when empty", async (format) => {
    const out = JSON.parse(render(await search(["Readable Co"]), format));
    expect(out).toHaveProperty("unreadable_companies", []);
    expect(Object.keys(out).indexOf("unreadable_companies")).toBe(Object.keys(out).indexOf("empty_reason") + 1);
  });
});
