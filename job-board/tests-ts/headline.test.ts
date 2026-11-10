/**
 * The headline states a fact. When no board could be read, "0 roles" is a false
 * fact about the company, so the headline must say the board was not read. When
 * roles existed and none matched the filters, "0 roles" is true and stays.
 */

import { describe, expect, it } from "vitest";

import { renderJobs } from "../src/cli.js";
import { SYMBOLS } from "../src/format-detail.js";
import { makeJob, resultHeadline, unreadableCompanies } from "../src/models.js";

const job = makeJob({
  title: "Engineer",
  company: "Acme",
  url: "https://jobs.example/1",
  source: "greenhouse",
  identifier: "1",
});

const NO_KEY = {
  kind: "no_key",
  provider: "kagi",
  variable: "JOB_BOARD_SEARCH_API_KEY",
  companies: ["Amazon"],
};

function opts(emptyReason: unknown) {
  return {
    boards: [],
    meta: {},
    queries: [],
    warnings: [],
    limit: null,
    emptyReason,
  } as Parameters<typeof renderJobs>[2];
}

describe("unreadableCompanies", () => {
  it("names the companies when nothing was read for a reason the user can fix", () => {
    expect(unreadableCompanies(0, NO_KEY)).toEqual(["Amazon"]);
    expect(unreadableCompanies(0, { kind: "no_board", companies: ["Acme", "Globex"] })).toEqual([
      "Acme",
      "Globex",
    ]);
  });

  it("is null when roles were returned", () => {
    expect(unreadableCompanies(3, NO_KEY)).toBeNull();
  });

  it("is null for a filtered result, where roles existed and none matched", () => {
    expect(unreadableCompanies(0, { kind: "filtered", raw: 40 })).toBeNull();
  });

  it("is null when there is no reason or no companies to name", () => {
    expect(unreadableCompanies(0, null)).toBeNull();
    expect(unreadableCompanies(0, { kind: "no_board", companies: [] })).toBeNull();
  });
});

describe("resultHeadline", () => {
  it("states the count, as before, for a normal result", () => {
    expect(resultHeadline(1, "Acme", null)).toBe("1 role at Acme");
    expect(resultHeadline(2, "", null)).toBe("2 roles");
  });

  it("says the board was not read, naming the company", () => {
    expect(resultHeadline(0, "", ["Amazon"])).toBe("Could not read the job board for Amazon");
  });

  it("pluralises for several companies", () => {
    expect(resultHeadline(0, "", ["Acme", "Globex"])).toBe(
      "Could not read the job boards for Acme, Globex",
    );
  });
});

describe("the headline in every human format", () => {
  it("markdown does not claim zero roles for an unreadable company", () => {
    const md = renderJobs([], "md", opts(NO_KEY));
    const first = md.split("\n")[0];
    expect(first).toBe("# Could not read the job board for Amazon");
    expect(md).not.toContain("0 roles");
  });

  it("detail uses the unreadable symbol, not the hiring symbol, and does not claim zero", () => {
    const detail = renderJobs([], "detail", opts(NO_KEY));
    const first = detail.split("\n")[0] as string;
    expect(first).toContain(SYMBOLS.unreadable);
    expect(first).not.toContain(SYMBOLS.hot);
    expect(first).toContain("Could not read the job board for Amazon");
    expect(detail).not.toContain("0 roles");
  });

  it("html heading does not claim zero roles for an unreadable company", () => {
    const html = renderJobs([], "html", opts(NO_KEY));
    expect(html).toContain("<h1>");
    expect(html).toContain("Could not read the job board for Amazon");
    expect(html).not.toContain("0 roles");
  });

  it("a filtered result keeps its accurate '0 roles' headline", () => {
    const md = renderJobs([], "md", opts({ kind: "filtered", raw: 40 }));
    expect(md.split("\n")[0]).toBe("# 0 roles");
  });

  it("a normal result is unchanged", () => {
    const md = renderJobs([job], "md", opts(null));
    expect(md.split("\n")[0]).toBe("# 1 role at Acme");
  });

  it("JSON is unchanged: count 0 with the reason in empty_reason", () => {
    const payload = JSON.parse(renderJobs([], "json", opts(NO_KEY)));
    expect(payload.count).toBe(0);
    expect(payload.empty_reason.kind).toBe("no_key");
  });
});
