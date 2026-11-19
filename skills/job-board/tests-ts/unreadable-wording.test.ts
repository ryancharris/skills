/**
 * An unreadable company's postings were never read, so no renderer may say "No roles
 * found" for it. A board that was read with nothing matching is a different, true
 * statement and keeps its own wording.
 */

import { describe, expect, it } from "vitest";

import { toDetail } from "../src/format-detail.js";
import { toHtml } from "../src/format-html.js";
import type { EmptyReason } from "../src/pipeline.js";
import { toMarkdown } from "../src/output.js";
import { unreadableWarning } from "../src/pipeline.js";

const noKey = (companies: string[]): EmptyReason => ({
  kind: "no_key",
  provider: "kagi",
  variable: "JOB_BOARD_SEARCH_API_KEY",
  companies,
});

const unreadable: Record<string, EmptyReason> = {
  no_key: noKey(["Amazon"]),
  "no_key, several": noKey(["Amazon", "Google"]),
  "no_board, no title": { kind: "no_board", companies: ["Amazon"], search: "no_title" },
  "no_board, with title": { kind: "no_board", companies: ["Amazon"], search: "no_results" },
  "no_board, search failed": { kind: "no_board", companies: ["Amazon"], search: "failed" },
};

const renderers = { md: toMarkdown, detail: toDetail, html: toHtml };

describe("unreadable company wording", () => {
  for (const [label, reason] of Object.entries(unreadable)) {
    for (const [name, render] of Object.entries(renderers)) {
      it(`${name} never says "no roles found" for ${label}`, () => {
        const out = render([], { emptyReason: reason });
        expect(out).not.toMatch(/no roles found/i);
        expect(out).not.toMatch(/uses a careers site/i);
        expect(out).toContain("Amazon");
      });
    }
  }

  for (const [name, render] of Object.entries(renderers)) {
    it(`${name} says no postings were read, not that there are none, for no_key`, () => {
      const out = render([], { emptyReason: noKey(["Amazon"]) });
      expect(out).toContain("No postings were read for");
      expect(out).toContain("That is not the same as having no roles.");
    });

    it(`${name} keeps the careers query and the optional key text for no_key`, () => {
      const out = render([], { emptyReason: noKey(["Amazon"]) });
      expect(out).toContain("JOB_BOARD_SEARCH_API_KEY");
      expect(out).toContain("Optional: set");
      expect(out).toMatch(/search for the company(&#39;|')s board/);
    });

    it(`${name} keeps the "none matched" wording for a board that was read`, () => {
      const out = render([], { emptyReason: { kind: "filtered", raw: 12 }, notes: [
        "12 open roles were found, but none matched your filters.",
      ] });
      expect(out).toContain("none matched your filters");
      expect(out).not.toContain("No postings were read");
    });

    it(`${name} keeps the generic no-match line when no reason is known`, () => {
      expect(render([])).toContain("No postings matched");
    });
  }

  it("the mixed-run warning does not say or quote 'no roles' as a finding", () => {
    for (const names of [["Amazon"], ["Amazon", "Google"]]) {
      const w = unreadableWarning(names);
      expect(w).not.toMatch(/no roles found/i);
      expect(w).toContain("not the same as having no roles");
    }
  });

  it("mixed-run warning renders in every format", () => {
    const note = unreadableWarning(["Amazon"]);
    for (const render of Object.values(renderers)) {
      const out = render([], { emptyReason: { kind: "filtered", raw: 3 }, notes: [note] });
      expect(out).not.toMatch(/no roles found/i);
      expect(out).toContain("not the same as having no roles");
    }
  });
});
