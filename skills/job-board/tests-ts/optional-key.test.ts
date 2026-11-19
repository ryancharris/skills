/**
 * The search key is an optional add-on. The text must never push it as the remedy:
 * not after a hiring check (--check never reads it), and not when no --title was
 * given (the search fallback cannot run without one).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { ATSAdapter } from "../src/ats.js";
import { renderJobs } from "../src/cli.js";
import { configFromEnv } from "../src/config.js";
import { emptyProfile, SEARCH_KEY_SETUP_URL } from "../src/models.js";
import { runSearch } from "../src/pipeline.js";

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(here, "..");
const repoRoot = resolve(skillRoot, "..", "..");
const cli = join(skillRoot, "dist", "main.js");
const preload = join(here, "e2e", "fake-smartrecruiters.mjs");

const KEY_TEXT = /JOB_BOARD_SEARCH_API_KEY|search key|API key/i;
const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const cache = await mkdtemp(join(tmpdir(), "job-board-optkey-"));
  dirs.push(cache);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    FAKE_SR_TOTAL: "0",
    JOB_BOARD_CACHE_DIR: cache,
    ...extraEnv,
  };
  return new Promise<{ stdout: string; stderr: string; code: number }>((done) => {
    execFile(process.execPath, ["--import", preload, cli, ...args], { env, timeout: 60_000 }, (error, stdout, stderr) => {
      done({ stdout, stderr, code: error && typeof error.code === "number" ? error.code : 0 });
    });
  });
}

function opts(emptyReason: unknown) {
  return { boards: [], meta: {}, queries: [], warnings: [], limit: null, emptyReason } as Parameters<
    typeof renderJobs
  >[2];
}

describe("--queries header", () => {
  it("says the queries are for pasting into a search engine, with no mention of the key", async () => {
    const out = await run(["--company", "Zzqx", "--title", "chief of staff", "--queries"]);
    expect(out.code).toBe(0);
    expect(out.stdout.split("\n")[0]).toBe("Site queries to paste into a search engine:");
    expect(out.stdout).not.toMatch(/key|export|execute/i);
  }, 20_000);
});

describe("no_board", () => {
  const NO_BOARD = (search: string) => ({ kind: "no_board", companies: ["Zzqx"], search });

  it("never advises the search key, in any renderer, whatever the cause", () => {
    for (const search of ["no_title", "no_results", "failed"]) {
      for (const fmt of ["md", "detail", "html"] as const) {
        expect(renderJobs([], fmt, opts(NO_BOARD(search))), `${fmt} ${search}`).not.toMatch(KEY_TEXT);
      }
    }
  });

  it("asks for a --title when that is the cause, and points to --queries", () => {
    for (const fmt of ["md", "detail", "html"] as const) {
      const out = renderJobs([], fmt, opts(NO_BOARD("no_title")));
      expect(out, fmt).toContain("Add a --title");
      expect(out, fmt).toContain("--queries");
    }
  });

  it("says plainly that the search fallback ran and found nothing, or failed", () => {
    for (const fmt of ["md", "detail", "html"] as const) {
      expect(renderJobs([], fmt, opts(NO_BOARD("no_results"))), fmt).toContain(
        "The search fallback ran and returned no search results.",
      );
      expect(renderJobs([], fmt, opts(NO_BOARD("failed"))), fmt).toContain("The search fallback failed");
      expect(renderJobs([], fmt, opts(NO_BOARD("no_results"))), fmt).not.toContain("--title");
    }
  });

  it("is produced with the cause: no title, an empty search, a failed search", async () => {
    class None extends ATSAdapter {
      readonly name = "ashby";
      async fetch() {
        return [];
      }
    }
    const base = { companies: ["Zzqx"], adapters: [new None()] };
    const cfg = configFromEnv({});
    const noTitle = await runSearch(emptyProfile(), { ...base, provider: null, config: cfg });
    expect(noTitle.empty_reason).toEqual({ kind: "no_board", companies: ["Zzqx"], search: "no_title" });

    const titled = { ...emptyProfile(), titles: ["engineer"] };
    const empty = await runSearch(titled, { ...base, provider: { name: "f", search: async () => [] } as never });
    expect(empty.empty_reason).toMatchObject({ kind: "no_board", search: "no_results" });

    const boom = {
      name: "f",
      search: async () => {
        throw new Error("boom");
      },
    } as never;
    const failed = await runSearch(titled, { ...base, provider: boom });
    expect(failed.empty_reason).toMatchObject({ kind: "no_board", search: "failed" });
  });

  it("end to end: no title, an empty search and a failed search each say their own cause", async () => {
    const noTitle = await run(["--company", "Zzqx", "--format", "md"]);
    expect(noTitle.stdout).toContain("Add a --title");
    const withKey = { JOB_BOARD_SEARCH_API_KEY: "k", FAKE_KAGI_EMPTY: "1" };
    const empty = await run(["--company", "Zzqx", "--title", "engineer", "--format", "md"], withKey);
    expect(empty.stdout).toContain("The search fallback ran and returned no search results.");
    expect(empty.stdout).not.toMatch(KEY_TEXT);
    const failed = await run(["--company", "Zzqx", "--title", "engineer", "--format", "md"], {
      JOB_BOARD_SEARCH_API_KEY: "k",
    });
    expect(failed.stdout).toContain("The search fallback failed");
  }, 30_000);
});

describe("no_key", () => {
  const NO_KEY = (companies: string[]) => ({
    kind: "no_key",
    provider: "kagi",
    variable: "JOB_BOARD_SEARCH_API_KEY",
    companies,
  });

  it("offers the key as optional, says what it returns, and links the setup", () => {
    const sentence =
      "Optional: set `JOB_BOARD_SEARCH_API_KEY` to also get search results from other ATS boards. " +
      "They may be other companies' roles, not Amazon's. Setup: " +
      SEARCH_KEY_SETUP_URL;
    expect(renderJobs([], "md", opts(NO_KEY(["Amazon"])))).toContain(sentence);
    expect(renderJobs([], "detail", opts(NO_KEY(["Amazon"])))).toContain(sentence);
  });

  it("html makes the setup a link and escapes the company name and apostrophes", () => {
    const html = renderJobs([], "html", opts(NO_KEY(["<b>Evil</b>"])));
    expect(html).toContain("Optional: set <code>JOB_BOARD_SEARCH_API_KEY</code> to also get search results");
    expect(html).toContain(`<a href="${SEARCH_KEY_SETUP_URL}">${SEARCH_KEY_SETUP_URL}</a>`);
    expect(html).toContain("&#39;");
    expect(html).not.toContain("<b>Evil</b>");
  });

  it("the setup link points at a file that exists in the repo", () => {
    const url = new URL(SEARCH_KEY_SETUP_URL);
    expect(url.hostname).toBe("github.com");
    const prefix = "/ryancharris/skills/blob/main/";
    expect(url.pathname.startsWith(prefix)).toBe(true);
    const file = join(repoRoot, url.pathname.slice(prefix.length));
    expect(file.endsWith(join("skills", "job-board", "references", "providers.md"))).toBe(true);
    expect(existsSync(file)).toBe(true);
  });
});

describe("--check never mentions the search key", () => {
  it("in json, md, detail or html, for an unreadable company, with or without a key set", async () => {
    for (const env of [{}, { JOB_BOARD_SEARCH_API_KEY: "k" }]) {
      for (const format of ["json", "md", "detail", "html"]) {
        const out = await run(["--check", "Zzqx", "--format", format], env);
        expect(out.code, format).toBe(0);
        expect(out.stdout, format).toContain("Zzqx");
        expect(out.stdout + out.stderr, format).not.toMatch(KEY_TEXT);
      }
    }
  }, 60_000);
});

describe("the careers query comes before the optional key", () => {
  const KEYED = {
    kind: "no_key",
    provider: "kagi",
    variable: "JOB_BOARD_SEARCH_API_KEY",
    companies: ["Zzqx", "Qqxz"],
  };
  const CAREERS = (c: string) => `"${c}" (careers OR jobs) (greenhouse OR lever OR ashby OR workday)`;
  const HINT = "run the same command with --queries";

  it("prints a careers query per company, then the site-query hint, then the key, in md and detail", () => {
    for (const fmt of ["md", "detail"] as const) {
      const out = renderJobs([], fmt, opts(KEYED));
      const careers = out.indexOf(CAREERS("Zzqx"));
      expect(careers, fmt).toBeGreaterThan(-1);
      expect(out, fmt).toContain(CAREERS("Qqxz"));
      expect(out, fmt).toContain("Next step for the user: find the careers page");
      const hint = out.indexOf(HINT);
      const key = out.indexOf("JOB_BOARD_SEARCH_API_KEY");
      expect(careers, fmt).toBeLessThan(hint);
      expect(hint, fmt).toBeLessThan(key);
      expect(out.split("JOB_BOARD_SEARCH_API_KEY").length - 1, fmt).toBe(1);
    }
  });

  it("html does the same, with the queries escaped", () => {
    const html = renderJobs([], "html", opts(KEYED));
    const careers = html.indexOf(`<code>${CAREERS("Zzqx").replace(/"/g, "&quot;")}</code>`);
    expect(careers).toBeGreaterThan(-1);
    expect(html).not.toContain(CAREERS("Zzqx"));
    expect(careers).toBeLessThan(html.indexOf(HINT));
    expect(html.indexOf(HINT)).toBeLessThan(html.indexOf("JOB_BOARD_SEARCH_API_KEY"));
    const evil = renderJobs([], "html", opts({ ...KEYED, companies: ["<script>x</script>"] }));
    expect(evil).not.toContain("<script>");
  });

  it("no_board prints the careers query in every renderer; the --queries hint only when a title was given", () => {
    for (const fmt of ["md", "detail", "html"] as const) {
      const noTitle = renderJobs([], fmt, opts({ kind: "no_board", companies: ["Zzqx"], search: "no_title" }));
      expect(noTitle, fmt).toContain("careers OR jobs");
      expect(noTitle, fmt).not.toContain("For site queries");
      expect(noTitle.split("--queries").length - 1, fmt).toBe(1);
      const empty = renderJobs([], fmt, opts({ kind: "no_board", companies: ["Zzqx"], search: "no_results" }));
      expect(empty, fmt).toContain("careers OR jobs");
      expect(empty, fmt).toContain(HINT);
      expect(empty, fmt).not.toMatch(KEY_TEXT);
    }
  });

  it("end to end, the unreadable-company output of a role search carries the careers query in md, detail and html", async () => {
    for (const format of ["md", "detail", "html"]) {
      const out = await run(["--company", "Zzqx", "--title", "engineer", "--format", format]);
      const text = out.stdout.replace(/&quot;/g, '"');
      expect(text, format).toContain(CAREERS("Zzqx"));
      expect(text.indexOf(CAREERS("Zzqx")), format).toBeLessThan(text.indexOf("Optional: set"));
    }
  }, 30_000);
});
