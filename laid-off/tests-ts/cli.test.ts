/**
 * CLI behaviour tests (no network).
 *
 * Ported from tests/test_cli.py, including the regression where a literal '%'
 * in help text crashed every invocation in the Python build.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { EXIT_OK, EXIT_USAGE, main, parseArgs } from "../src/cli.js";
import { makeJob } from "../src/models.js";
import * as pipeline from "../src/pipeline.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "dist", "main.js");

const stubResult = (): pipeline.RunResult => ({
  jobs: [makeJob({ title: "Engineer", company: "Acme", url: "https://x/1", source: "greenhouse" })],
  boards: [],
  companies: ["Acme"],
  warnings: [],
  queries: ['site:jobs.ashbyhq.com ("CoS")'],
  signals: [],
  raw_count: 1,
  matched_count: 1,
});

describe("parseArgs", () => {
  it("parses defaults", () => {
    const opts = parseArgs(["--company", "Acme"]);
    expect(opts?.company).toEqual(["Acme"]);
    expect(opts?.format).toBe("json");
    expect(opts?.check).toEqual([]);
    expect(opts?.recentDays).toBe(30);
    expect(opts?.limit).toBe(50);
  });

  it("supports --flag=value", () => {
    const opts = parseArgs(["--company=Acme", "--format=md"]);
    expect(opts?.company).toEqual(["Acme"]);
    expect(opts?.format).toBe("md");
  });

  it("rejects an unknown argument", () => {
    expect(parseArgs(["--nope"])).toBeNull();
  });

  it("rejects a missing value", () => {
    expect(parseArgs(["--company"])).toBeNull();
  });

  it("rejects an invalid format", () => {
    expect(parseArgs(["--format", "yaml"])).toBeNull();
  });

  it("collects repeatable flags", () => {
    const opts = parseArgs(["--company", "A", "--company", "B", "--title", "x", "--title", "y"]);
    expect(opts?.company).toEqual(["A", "B"]);
    expect(opts?.title).toEqual(["x", "y"]);
  });
});

describe("main", () => {
  it("renders --help without crashing (regression: '%' broke argparse)", async () => {
    const code = await main(["--help"]);
    expect(code).toBe(EXIT_OK);
  });

  it("requires a target", async () => {
    expect(await main([])).toBe(EXIT_USAGE);
  });

  it("--queries needs a title", async () => {
    expect(await main(["--company", "Acme", "--queries"])).toBe(EXIT_USAGE);
  });

  it("generates site: queries without touching the network", async () => {
    const spy = vi.spyOn(pipeline, "runSearch");
    expect(await main(["--company", "Acme", "--title", "CoS", "--queries"])).toBe(EXIT_OK);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("emits JSON by default", async () => {
    vi.spyOn(pipeline, "runSearch").mockResolvedValue(stubResult());
    expect(await main(["--company", "Acme"])).toBe(EXIT_OK);
    vi.restoreAllMocks();
  });

  it("honours --format json-compact", async () => {
    vi.spyOn(pipeline, "runSearch").mockResolvedValue(stubResult());
    expect(await main(["--company", "Acme", "--format", "json-compact"])).toBe(EXIT_OK);
    vi.restoreAllMocks();
  });

  it("warns about filters ignored by --check", async () => {
    vi.spyOn(pipeline, "checkHiring").mockResolvedValue({
      ...stubResult(),
      signals: [],
    });
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    await main(["--check", "Acme", "--title", "engineer", "--remote"]);
    const err = written.join("");
    expect(err).toContain("--check ignores role filters");
    expect(err).toContain("--title");
    vi.restoreAllMocks();
  });

  it("--check --list-boards prints boards", async () => {
    vi.spyOn(pipeline, "checkHiring").mockResolvedValue({
      ...stubResult(),
      boards: [{ company: "Stripe", ats: "greenhouse", slug: "stripe", job_count: 767, url: "" }],
    });
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    expect(await main(["--check", "Stripe", "--list-boards"])).toBe(EXIT_OK);
    expect(written.join("")).toContain("Stripe\tgreenhouse\tstripe\t767");
    vi.restoreAllMocks();
  });
});

describe("entry point", () => {
  it("runs from an unrelated cwd without PYTHONPATH or install", () => {
    const result = spawnSync(process.execPath, [entry, "--help"], {
      cwd: "/tmp",
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--company");
  });

  it("prints a version", () => {
    const result = spawnSync(process.execPath, [entry, "--version"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("laid-off");
  });
});
