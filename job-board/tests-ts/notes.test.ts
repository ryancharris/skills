/**
 * Plain-text notes for the human formats. A person must see what an agent is
 * told: that a read was partial, that data came from the cache, and any warning
 * the run produced. JSON already carries these as fields, and stays unchanged.
 */

import { describe, expect, it } from "vitest";

import { renderHiring, renderJobs } from "../src/cli.js";
import { makeJob, noteLines, partialWarning, type PartialBoard } from "../src/models.js";
import { toHtml } from "../src/format-html.js";

const PARTIAL: PartialBoard = { company: "Acme", ats: "smartrecruiters", read: 1000, reported: 1500 };
const WARNING = "Could not look up Globex: connection reset";
const CACHED = { cached: true, fetchedAt: "2026-01-01T09:30:00.000Z" };

const job = makeJob({
  title: "Engineer",
  company: "Acme",
  url: "https://jobs.example/1",
  source: "greenhouse",
  identifier: "1",
});

const EMPTY = { boards: [], meta: {}, queries: [], warnings: [], limit: null, emptyReason: null };

describe("noteLines", () => {
  it("states a partial board once, in plain words", () => {
    expect(noteLines({ partialBoards: [PARTIAL] })).toEqual([
      "Partial: Acme's smartrecruiters board has 1500 postings but only 1000 were read. Results for this company are incomplete.",
    ]);
  });

  it("does not repeat a partial board's warning among the warnings", () => {
    const lines = noteLines({ partialBoards: [PARTIAL], warnings: [partialWarning(PARTIAL), WARNING] });
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith("Partial:"))).toHaveLength(1);
    expect(lines).toContain(WARNING);
  });

  it("names the cache time when data came from the cache", () => {
    const lines = noteLines({ cached: true, fetchedAt: CACHED.fetchedAt });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Cached:");
    expect(lines[0]).toContain(CACHED.fetchedAt);
  });

  it("says the time is unknown rather than inventing one", () => {
    expect(noteLines({ cached: true, fetchedAt: null })[0]).toContain("unknown time");
  });

  it("adds no cache line for live data", () => {
    expect(noteLines({ cached: false, fetchedAt: "2026-01-01T00:00:00.000Z" })).toEqual([]);
  });

  it("keeps each warning once, in order", () => {
    expect(noteLines({ warnings: [WARNING, "other", WARNING] })).toEqual([WARNING, "other"]);
  });

  it("returns nothing when there is nothing to say", () => {
    expect(noteLines({})).toEqual([]);
  });
});

describe("warnings reach every human format", () => {
  it("md, detail and html show a warning from a role search", () => {
    const opts = { ...EMPTY, warnings: [WARNING] };
    expect(renderJobs([job], "md", opts)).toContain(WARNING);
    expect(renderJobs([job], "detail", opts)).toContain(WARNING);
    expect(renderJobs([job], "html", opts)).toContain("Could not look up Globex: connection reset");
  });

  it("md, detail and html show a warning from --check", () => {
    expect(renderHiring([], "md", [], [WARNING])).toContain(WARNING);
    expect(renderHiring([], "detail", [], [WARNING])).toContain(WARNING);
    expect(renderHiring([], "html", [], [WARNING])).toContain("Could not look up Globex");
  });

  it("escapes a warning in html", () => {
    const html = toHtml([job], { notes: ["<script>x</script>"] });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("cache provenance reaches every human format", () => {
  const prov = { cached: true, oldest: Date.parse(CACHED.fetchedAt) };

  it("role search md, detail and html say the data is cached, with the time", () => {
    for (const format of ["md", "detail", "html"]) {
      const out = renderJobs([job], format, { ...EMPTY, provenance: prov });
      expect(out, format).toContain("Cached:");
      expect(out, format).toContain(CACHED.fetchedAt);
    }
  });

  it("--check md, detail and html say the same", () => {
    for (const format of ["md", "detail", "html"]) {
      const out = renderHiring([], format, [], [], prov);
      expect(out, format).toContain("Cached:");
    }
  });

  it("live data shows no cache note in any human format", () => {
    const live = { cached: false, oldest: Date.parse(CACHED.fetchedAt) };
    for (const format of ["md", "detail", "html"]) {
      expect(renderJobs([job], format, { ...EMPTY, provenance: live }), format).not.toContain("Cached:");
      expect(renderHiring([], format, [], [], live), format).not.toContain("Cached:");
    }
  });
});

describe("JSON is unchanged by the notes", () => {
  it("does not gain a notes field, and keeps warnings as data", () => {
    const out = JSON.parse(renderJobs([job], "json", { ...EMPTY, warnings: [WARNING] }));
    expect(out).not.toHaveProperty("notes");
    expect(out.warnings).toEqual([WARNING]);
  });
});
