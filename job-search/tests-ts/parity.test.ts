/**
 * Parity harness: assert the TypeScript port reproduces the Python
 * implementation's output EXACTLY on the pure functions.
 *
 * The vectors in `vectors.json` were produced by the Python code before the
 * port, so this is evidence rather than an assertion that "it looks right".
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ashbyPayForLocation } from "../src/ats.js";
import { slugCandidates } from "../src/discovery.js";
import { buildSiteQuery, expandTitles, titleContains } from "../src/filtering.js";
import { displayCompany, friendlyDepartment } from "../src/hiring-signal.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8")) as Record<
  string,
  Record<string, unknown>
>;

describe("parity with the Python implementation", () => {
  it("slug_candidates", () => {
    for (const [input, expected] of Object.entries(vectors.slug_candidates)) {
      expect(slugCandidates(input), `slugCandidates(${JSON.stringify(input)})`).toEqual(expected);
    }
  });

  it("expand_titles", () => {
    for (const [input, expected] of Object.entries(vectors.expand_titles)) {
      expect(expandTitles([input]), `expandTitles(${JSON.stringify(input)})`).toEqual(expected);
    }
  });

  it("build_site_query", () => {
    expect(buildSiteQuery("jobs.ashbyhq.com", expandTitles(["chief of staff"]))).toBe(
      vectors.build_site_query.cos,
    );
    expect(
      buildSiteQuery("boards.greenhouse.io", expandTitles(["chief of staff"]), ["New York"]),
    ).toBe(vectors.build_site_query["cos+loc"]);
  });

  it("title_contains", () => {
    for (const [key, expected] of Object.entries(vectors.title_contains)) {
      const [title, term] = key.split("|") as [string, string];
      expect(titleContains(title, term), `titleContains(${title}, ${term})`).toBe(expected);
    }
  });

  it("display_company", () => {
    for (const [input, expected] of Object.entries(vectors.display_company)) {
      expect(displayCompany(input), `displayCompany(${JSON.stringify(input)})`).toBe(expected);
    }
  });

  it("friendly_department", () => {
    for (const [input, expected] of Object.entries(vectors.friendly_department)) {
      expect(friendlyDepartment(input), `friendlyDepartment(${JSON.stringify(input)})`).toBe(expected);
    }
  });

  it("ashby pay-tier selection", () => {
    const tiers = {
      compensationTierSummary: "S",
      compensationTiers: [
        { tierSummary: "CA$1", components: [{ compensationType: "Salary", currencyCode: "CAD" }] },
        { tierSummary: "$1", components: [{ compensationType: "Salary", currencyCode: "USD" }] },
      ],
    };
    for (const [location, expected] of Object.entries(vectors.ashby_pay)) {
      expect(ashbyPayForLocation(tiers, location), `ashbyPay(${location})`).toBe(expected);
    }
  });
});
