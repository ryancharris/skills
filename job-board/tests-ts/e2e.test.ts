/**
 * End to end: run the built CLI (dist/main.js) as a child process against a
 * synthetic SmartRecruiters board, and check what a user or agent actually gets.
 *
 * No network and no API keys. The child loads tests-ts/e2e/fake-smartrecruiters.mjs,
 * which serves the board and 404s every other host. Keys are stripped from the
 * child's environment, so a search fallback cannot bill anyone either.
 *
 * These run in `npm test`, so CI exercises the shipped dist/ build.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(here, "..");
const cli = join(skillRoot, "dist", "main.js");
const preload = join(here, "e2e", "fake-smartrecruiters.mjs");

const TIMEOUT = 20_000;
const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function freshCacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "job-board-e2e-"));
  dirs.push(dir);
  return dir;
}

interface Run {
  stdout: string;
  code: number;
}

/** Run the built CLI against a synthetic board of `total` postings. */
function runCli(args: string[], total: number, cacheDir?: string): Promise<Run> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    FAKE_SR_TOTAL: String(total),
  };
  if (cacheDir) env.LAID_OFF_CACHE_DIR = cacheDir;
  return new Promise((done) => {
    execFile(
      process.execPath,
      ["--import", preload, cli, ...args],
      { env, timeout: 60_000 },
      (error, stdout) => {
        const code = error && typeof error.code === "number" ? error.code : 0;
        done({ stdout, code });
      },
    );
  });
}

describe("end to end through the built CLI (synthetic board, no network)", () => {
  it(
    "flags a board larger than the read limit as partial",
    async () => {
      const run = await runCli(["--company", "Acme", "--title", "engineer", "--format", "json-compact", "--limit", "2"], 1500);
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout);
      expect(out.partial).toBe(true);
      expect(out.partial_boards).toEqual([
        { company: "Acme", ats: "smartrecruiters", read: 1000, reported: 1500 },
      ]);
      expect(out.count).toBe(2);
      expect(out.total).toBe(1000);
    },
    TIMEOUT,
  );

  it(
    "does not flag a board that was read in full",
    async () => {
      const run = await runCli(["--company", "Acme", "--title", "engineer", "--format", "json-compact"], 800);
      const out = JSON.parse(run.stdout);
      expect(out.partial).toBe(false);
      expect(out.partial_boards).toEqual([]);
      expect(out.total).toBe(800);
    },
    TIMEOUT,
  );

  it(
    "markdown carries the partial line and the badges on each role",
    async () => {
      const run = await runCli(["--company", "Acme", "--title", "engineer", "--format", "md", "--limit", "1"], 1500);
      expect(run.stdout).toContain(
        "Partial: Acme's smartrecruiters board has 1500 postings but only 1000 were read.",
      );
      const heading = run.stdout.split("\n").find((line) => line.startsWith("### "));
      expect(heading).toMatch(/^### \S+ \[Engineer 0\]\(https:\/\/jobs\.smartrecruiters\.com\/acme\/0\)$/);
    },
    TIMEOUT,
  );

  it(
    "a repeat run inside the cache TTL is reported as cached",
    async () => {
      const cacheDir = await freshCacheDir();
      const args = ["--company", "Acme", "--title", "engineer", "--format", "json-compact", "--limit", "1", "--cache-ttl", "300"];

      const first = JSON.parse((await runCli(args, 800, cacheDir)).stdout);
      expect(first.cached).toBe(false);

      const second = JSON.parse((await runCli(args, 800, cacheDir)).stdout);
      expect(second.cached).toBe(true);
      expect(second.fetched_at).not.toBeNull();
    },
    TIMEOUT,
  );

  it(
    "a cached run says so in the markdown the person reads",
    async () => {
      const cacheDir = await freshCacheDir();
      const args = ["--company", "Acme", "--title", "engineer", "--format", "md", "--limit", "1", "--cache-ttl", "300"];
      await runCli(args, 800, cacheDir);
      const second = await runCli(args, 800, cacheDir);
      expect(second.stdout).toContain("Cached: some board data came from the cache");
    },
    TIMEOUT,
  );

  it(
    "a run without a cache TTL is never reported as cached",
    async () => {
      const cacheDir = await freshCacheDir();
      const args = ["--company", "Acme", "--title", "engineer", "--format", "json-compact", "--limit", "1"];
      const out = JSON.parse((await runCli(args, 800, cacheDir)).stdout);
      expect(out.cached).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "the documented invocation works from an unrelated directory",
    async () => {
      const elsewhere = await mkdtemp(join(tmpdir(), "job-board-cwd-"));
      dirs.push(elsewhere);
      const out = await new Promise<string>((done, fail) => {
        execFile(process.execPath, [cli, "--version"], { cwd: elsewhere }, (error, stdout) =>
          error ? fail(error) : done(stdout),
        );
      });
      expect(out).toMatch(/^job-board \d/);
    },
    TIMEOUT,
  );
});
