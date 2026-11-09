/**
 * Slug discovery: map a company name to live ATS board(s).
 *
 * Ported from jobsearch/discovery.py. Two behaviours are non-obvious and must
 * not regress:
 *
 *  - Diacritics fold to ASCII, so "Société Générale" -> slug `societegenerale`.
 *    Python used unicodedata.normalize("NFKD"); JS has the same normalisation.
 *  - A non-empty board is NOT proof of the right company. `general motors`
 *    matched a board named "General Interest", so a board is accepted only when
 *    the queried company name accounts for most of the board's own name.
 */

import { allAdapters, type ATSAdapter } from "./ats.js";
import { HttpError } from "./http.js";
import type { Board } from "./models.js";

const NON_ALNUM = /[^a-z0-9]+/g;

/** Fraction of a board's own name tokens that must be covered by the query. */
const IDENTITY_COVERAGE = 0.66;

const DROP_TOKENS = new Set([
  "inc", "llc", "ltd", "corp", "corporation", "company", "co", "plc",
  "holdings", "group", "the", "and",
]);

/**
 * Lowercase and strip diacritics so accented names map to real slugs.
 *
 * "Societe Generale" is served from slug `societegenerale`, so "Société
 * Générale" must fold to that rather than lose the accented letters.
 */
export function fold(text: string): string {
  const decomposed = text.normalize("NFKD");
  // \p{M} = any combining mark; equivalent to Python's unicodedata.combining().
  return decomposed.replace(/\p{M}/gu, "");
}

/**
 * Generate plausible ATS slugs for a company name, most likely first.
 *
 * "Meta Platforms" -> ["metaplatforms", "meta", "meta-platforms", ...]
 */
export function slugCandidates(company: string): string[] {
  const low = fold(company.toLowerCase()).trim();
  const tokens = low.split(NON_ALNUM).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const core = tokens.filter((t) => !DROP_TOKENS.has(t));
  const useCore = core.length > 0 ? core : tokens;

  const out: string[] = [];
  out.push(useCore.join(""));
  if (useCore.length > 1) {
    out.push(useCore[0] as string);
    out.push(useCore.join("-"));
  }
  out.push(tokens.join(""));

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of out) {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

function tokensOf(text: string): Set<string> {
  return new Set(
    fold(text.toLowerCase())
      .split(NON_ALNUM)
      .filter((t) => t.length > 0 && !DROP_TOKENS.has(t)),
  );
}

/**
 * Guard against slug collisions across companies.
 *
 * A bare first-token slug matches unrelated boards ("general motors" -> board
 * `general` = "General Interest"). When the vendor exposes a company name,
 * require the queried company to account for most of the board's name.
 */
export function boardBelongsTo(
  company: string,
  adapter: ATSAdapter,
  slug: string,
): boolean {
  let actual: string | null = null;
  try {
    actual = adapter.boardCompany(slug);
  } catch {
    actual = null;
  }
  if (!actual) return true; // vendor gives no identity (Ashby): trust 404s

  const want = tokensOf(company);
  const have = tokensOf(actual);
  if (want.size === 0 || have.size === 0) return false;

  let shared = 0;
  for (const token of have) if (want.has(token)) shared++;

  return shared / have.size >= IDENTITY_COVERAGE;
}

export interface DiscoverOptions {
  adapters?: ATSAdapter[];
  maxWorkers?: number;
  /** Collects messages for transient failures (network, timeout, 5xx). */
  errors?: string[];
}

/**
 * Probe ATSes for a company and return every live board, biggest first.
 *
 * `errors` matters: swallowing every failure made a DNS blip indistinguishable
 * from "this company has no board", so a transient error told the user Stripe
 * had no jobs.
 */
export async function discoverBoards(
  company: string,
  options: DiscoverOptions = {},
): Promise<Board[]> {
  const adapters = options.adapters ?? allAdapters();
  const errors = options.errors;
  const candidates = slugCandidates(company);
  if (candidates.length === 0) return [];

  const probe = async (adapter: ATSAdapter): Promise<Board[]> => {
    for (const slug of candidates) {
      try {
        const jobs = await adapter.fetch(slug);
        if (jobs.length === 0) continue;
        if (!boardBelongsTo(company, adapter, slug)) continue;

        let count = jobs.length;
        if (adapter.name === "smartrecruiters" && adapter.totalCount) {
          try {
            count = (await adapter.totalCount(slug)) || count;
          } catch {
            /* keep the page length */
          }
        }
        return [{ company, ats: adapter.name, slug, job_count: count, url: "" }];
      } catch (err) {
        const transient =
          err instanceof HttpError ? !err.isMissingBoard : true;
        if (transient && errors) {
          const kind = err instanceof HttpError ? err.message : (err as Error)?.name ?? "Error";
          errors.push(
            `${company}: ${adapter.name} lookup failed (${kind}); results may be incomplete`,
          );
        }
        continue;
      }
    }
    return [];
  };

  const results = await Promise.all(adapters.map(probe));
  const boards = results.flat();
  boards.sort((a, b) => b.job_count - a.job_count);
  return boards;
}
