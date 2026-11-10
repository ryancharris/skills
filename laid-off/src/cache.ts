/**
 * On-disk response cache for ATS lookups.
 *
 * Ported from jobsearch/cache.py. Deliberately simple and opt-in:
 *
 *  - Disabled by default (ttl 0), because stale data in a job search is a
 *    correctness risk and the caller should choose it explicitly.
 *  - Keyed by a hash of the request URL, so different queries never collide.
 *  - Any cache failure (permissions, corrupt JSON, clock skew) degrades to a
 *    miss and a normal fetch. The cache must never be able to break a run.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CacheOptions {
  ttl: number;
  cacheDir: string;
}

export function keyOf(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex").slice(0, 32);
}

function pathOf(cacheDir: string, url: string): string {
  return join(cacheDir, `${keyOf(url)}.json`);
}

/**
 * Return the cached payload and when it was stored (ms since epoch), or null on
 * miss, expiry, or any error.
 */
export async function lookup(
  url: string,
  { ttl, cacheDir }: CacheOptions,
): Promise<{ payload: unknown; storedAt: number } | null> {
  if (ttl <= 0 || !cacheDir) return null;
  const path = pathOf(cacheDir, url);
  try {
    const info = await stat(path);
    if (Date.now() / 1000 - info.mtimeMs / 1000 > ttl) return null;
    return { payload: JSON.parse(await readFile(path, "utf8")), storedAt: info.mtimeMs };
  } catch {
    return null;
  }
}

/** Return the cached payload for `url`, or null on miss/expiry/any error. */
export async function get(url: string, options: CacheOptions): Promise<unknown | null> {
  const hit = await lookup(url, options);
  return hit === null ? null : hit.payload;
}

/** Store `payload` for `url`. Silently does nothing on any failure. */
export async function put(
  url: string,
  payload: unknown,
  { cacheDir }: { cacheDir: string },
): Promise<void> {
  if (!cacheDir) return;
  try {
    await mkdir(cacheDir, { recursive: true });
    const path = pathOf(cacheDir, url);
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    await rename(tmp, path); // atomic: readers never see a partial file
  } catch {
    /* cache is best-effort */
  }
}

/** Delete cached entries; returns how many files were removed. */
export async function clear(cacheDir: string): Promise<number> {
  if (!cacheDir || !existsSync(cacheDir)) return 0;
  let removed = 0;
  try {
    for (const name of await readdir(cacheDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        await rm(join(cacheDir, name));
        removed++;
      } catch {
        /* skip */
      }
    }
  } catch {
    return removed;
  }
  return removed;
}
