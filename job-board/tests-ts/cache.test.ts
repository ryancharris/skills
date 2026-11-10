/**
 * Tests for the on-disk response cache.
 *
 * Ported from tests/test_cache.py. The cache must never be able to break a run:
 * every failure path degrades to a miss.
 */

import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as cache from "../src/cache.js";
import * as http from "../src/http.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jscache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cache", () => {
  it("misses on an empty dir", async () => {
    expect(await cache.get("https://x/1", { ttl: 60, cacheDir: dir })).toBeNull();
  });

  it("round-trips a payload", async () => {
    const url = "https://x/1";
    await cache.put(url, { jobs: [1, 2] }, { cacheDir: dir });
    expect(await cache.get(url, { ttl: 60, cacheDir: dir })).toEqual({ jobs: [1, 2] });
  });

  it("expires after the ttl", async () => {
    const url = "https://x/1";
    await cache.put(url, { a: 1 }, { cacheDir: dir });
    const path = join(dir, `${cache.keyOf(url)}.json`);
    const old = Date.now() / 1000 - 1000;
    await utimes(path, old, old);
    expect(await cache.get(url, { ttl: 60, cacheDir: dir })).toBeNull();
  });

  it("is disabled at ttl 0", async () => {
    const url = "https://x/1";
    await cache.put(url, { a: 1 }, { cacheDir: dir });
    expect(await cache.get(url, { ttl: 0, cacheDir: dir })).toBeNull();
  });

  it("does not collide different urls", async () => {
    await cache.put("https://x/1", { v: 1 }, { cacheDir: dir });
    await cache.put("https://x/2", { v: 2 }, { cacheDir: dir });
    expect(await cache.get("https://x/1", { ttl: 60, cacheDir: dir })).toEqual({ v: 1 });
    expect(await cache.get("https://x/2", { ttl: 60, cacheDir: dir })).toEqual({ v: 2 });
  });

  it("treats a corrupt entry as a miss", async () => {
    const url = "https://x/1";
    await writeFile(join(dir, `${cache.keyOf(url)}.json`), "{not json");
    expect(await cache.get(url, { ttl: 60, cacheDir: dir })).toBeNull();
  });

  it("never throws when the cache dir cannot be created", async () => {
    // Portable failure: use a *file* as a directory component. Gives ENOTDIR on
    // every platform. An earlier version used /proc/..., which fails fast with
    // ENOENT on macOS but HANGS on Linux, so it passed locally and timed out in
    // CI on all three Node versions.
    const blocker = join(dir, "not-a-dir");
    await writeFile(blocker, "x");
    const bad = join(blocker, "cache");

    await expect(cache.put("https://x/1", { a: 1 }, { cacheDir: bad })).resolves.toBeUndefined();
    expect(await cache.get("https://x/1", { ttl: 60, cacheDir: bad })).toBeNull();
  });

  it("fails fast rather than hanging on a bad cache dir", async () => {
    // Guards the CI timeout regression above: the call must return quickly
    // rather than blocking until the test runner kills it.
    const blocker = join(dir, "not-a-dir-2");
    await writeFile(blocker, "x");
    const started = Date.now();
    await cache.put("https://x/1", { a: 1 }, { cacheDir: join(blocker, "c") });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("is a no-op with an empty cache dir", async () => {
    await cache.put("https://x/1", { a: 1 }, { cacheDir: "" });
    expect(await cache.get("https://x/1", { ttl: 60, cacheDir: "" })).toBeNull();
  });

  it("clears entries", async () => {
    await cache.put("https://x/1", { a: 1 }, { cacheDir: dir });
    await cache.put("https://x/2", { b: 2 }, { cacheDir: dir });
    expect(await cache.clear(dir)).toBe(2);
    expect(await cache.get("https://x/1", { ttl: 60, cacheDir: dir })).toBeNull();
  });

  it("clears a missing dir to zero", async () => {
    expect(await cache.clear(join(dir, "nope"))).toBe(0);
  });

  it("writes valid json", async () => {
    await cache.put("https://x/1", { a: [1, { b: 2 }] }, { cacheDir: dir });
    const raw = await readFile(join(dir, `${cache.keyOf("https://x/1")}.json`), "utf8");
    expect(JSON.parse(raw)).toEqual({ a: [1, { b: 2 }] });
  });
});

describe("getJson caching", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const stubFetch = (body: string, status = 200) => {
    const calls = { n: 0 };
    globalThis.fetch = (async () => {
      calls.n++;
      return new Response(body, { status });
    }) as typeof fetch;
    return calls;
  };

  it("reads through the cache", async () => {
    const calls = stubFetch('{"v":1}');
    expect(await http.getJson("https://y/1", { cacheTtl: 60, cacheDir: dir })).toEqual({ v: 1 });
    expect(await http.getJson("https://y/1", { cacheTtl: 60, cacheDir: dir })).toEqual({ v: 1 });
    expect(calls.n).toBe(1);
    await http.getJson("https://y/1", { cacheTtl: 0, cacheDir: dir });
    expect(calls.n).toBe(2);
  });

  it("never caches a POST (billed per call)", async () => {
    const calls = stubFetch('{"data":[]}');
    await http.postJson("https://z/1", { query: "q" });
    await http.postJson("https://z/1", { query: "q" });
    expect(calls.n).toBe(2);
  });

  it("raises a parse error, not a misleading 200", async () => {
    stubFetch("<!DOCTYPE html><html>nope</html>");
    await expect(http.getJson("https://t/1")).rejects.toMatchObject({ kind: "parse" });
  });
});
