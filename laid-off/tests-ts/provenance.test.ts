/**
 * Cache provenance: a run must say whether its ATS data came from the cache and
 * how old it is, so an agent cannot present a cached board as "just checked".
 *
 * Every getJson call here is a cache hit, so nothing reaches the network.
 */

import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import * as cache from "../src/cache.js";
import { getJson } from "../src/http.js";
import { toHiringJson, toJson } from "../src/output.js";
import { makeJob } from "../src/models.js";
import { cacheFields, fetchedAtIso, recordRead, trackProvenance } from "../src/provenance.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const EMOJI = /\p{Extended_Pictographic}/u;

const job = makeJob({
  title: "Role",
  company: "Acme",
  url: "https://jobs.example/1",
  source: "smartrecruiters",
  identifier: "1",
});

describe("tracking a run", () => {
  it("reports no cache and no fetch time when nothing was read", async () => {
    const { value, provenance } = await trackProvenance(async () => "done");
    expect(value).toBe("done");
    expect(provenance).toEqual({ cached: false, oldest: null });
  });

  it("a live read is not cached and sets the fetch time", async () => {
    const { provenance } = await trackProvenance(async () => {
      recordRead({ cached: false, at: 1000 });
    });
    expect(provenance).toEqual({ cached: false, oldest: 1000 });
  });

  it("one cached read makes the run cached; the oldest time wins", async () => {
    const { provenance } = await trackProvenance(async () => {
      recordRead({ cached: true, at: 5000 });
      recordRead({ cached: false, at: 3000 });
      recordRead({ cached: false, at: 9000 });
    });
    expect(provenance).toEqual({ cached: true, oldest: 3000 });
  });

  it("a cache entry written during this run is not reported as cached", async () => {
    const { provenance } = await trackProvenance(async () => {
      recordRead({ cached: true, at: Date.now() });
    });
    expect(provenance.cached).toBe(false);
    expect(provenance.oldest).not.toBeNull();
  });

  it("ignores reads made outside a tracked run", async () => {
    expect(() => recordRead({ cached: true, at: 1 })).not.toThrow();
    const { provenance } = await trackProvenance(async () => undefined);
    expect(provenance).toEqual({ cached: false, oldest: null });
  });

  it("keeps concurrent runs separate", async () => {
    const [a, b] = await Promise.all([
      trackProvenance(async () => {
        await sleep(5);
        recordRead({ cached: true, at: 1 });
      }),
      trackProvenance(async () => {
        recordRead({ cached: false, at: 2 });
      }),
    ]);
    expect(a.provenance).toEqual({ cached: true, oldest: 1 });
    expect(b.provenance).toEqual({ cached: false, oldest: 2 });
  });

  it("formats the oldest time as ISO 8601", () => {
    expect(fetchedAtIso({ cached: false, oldest: 0 })).toBe("1970-01-01T00:00:00.000Z");
    expect(fetchedAtIso({ cached: false, oldest: null })).toBeNull();
  });
});

describe("getJson on a cache hit", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  async function freshDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "laid-off-prov-"));
    dirs.push(dir);
    return dir;
  }

  it("returns the cached payload and marks the run cached", async () => {
    const dir = await freshDir();
    const url = "https://example.invalid/board-a";
    await cache.put(url, { jobs: [1] }, { cacheDir: dir });
    // 30s old against a 60s TTL: well inside the window, so no timing race at the boundary.
    const thirtySecAgo = (Date.now() - 30_000) / 1000;
    await utimes(join(dir, `${cache.keyOf(url)}.json`), thirtySecAgo, thirtySecAgo);

    const { value, provenance } = await trackProvenance(() =>
      getJson(url, { cacheTtl: 60, cacheDir: dir }),
    );
    expect(value).toEqual({ jobs: [1] });
    expect(provenance.cached).toBe(true);
    expect(Math.abs(Date.now() - 30_000 - (provenance.oldest as number))).toBeLessThan(2_000);
  });

  it("reports the entry's real age, not the time it was read", async () => {
    const dir = await freshDir();
    const url = "https://example.invalid/board-b";
    await cache.put(url, { jobs: [] }, { cacheDir: dir });

    const thirtyMinAgo = (Date.now() - 30 * 60_000) / 1000;
    await utimes(join(dir, `${cache.keyOf(url)}.json`), thirtyMinAgo, thirtyMinAgo);

    const { provenance } = await trackProvenance(() =>
      getJson(url, { cacheTtl: 3600, cacheDir: dir }),
    );
    const ageMinutes = (Date.now() - (provenance.oldest as number)) / 60_000;
    expect(ageMinutes).toBeGreaterThan(29);
    expect(ageMinutes).toBeLessThan(31);
  });

  it("a stale entry is not served at all", async () => {
    const dir = await freshDir();
    const url = "https://example.invalid/board-c";
    await cache.put(url, { jobs: [] }, { cacheDir: dir });

    const twoHoursAgo = (Date.now() - 2 * 3600_000) / 1000;
    await utimes(join(dir, `${cache.keyOf(url)}.json`), twoHoursAgo, twoHoursAgo);

    expect(await cache.lookup(url, { ttl: 60, cacheDir: dir })).toBeNull();
  });
});

describe("the JSON contract carries the provenance", () => {
  it("defaults to not cached with no fetch time", () => {
    const payload = JSON.parse(toJson([job]));
    expect(payload.cached).toBe(false);
    expect(payload.fetched_at).toBeNull();
  });

  it("reports cached and the fetch time when set", () => {
    const payload = JSON.parse(
      toJson([job], { cached: true, fetchedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(payload.cached).toBe(true);
    expect(payload.fetched_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("hiring JSON carries the same fields", () => {
    const payload = JSON.parse(
      toHiringJson([], { cached: true, fetchedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(payload.cached).toBe(true);
    expect(payload.fetched_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("maps an absent provenance to not cached", () => {
    expect(cacheFields(undefined)).toEqual({ cached: false, fetchedAt: null });
  });

  it("stays free of emoji", () => {
    expect(EMOJI.test(toJson([job], { cached: true, fetchedAt: "2026-01-01T00:00:00.000Z" }))).toBe(false);
  });
});
