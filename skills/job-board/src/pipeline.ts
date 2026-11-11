/**
 * Pipeline orchestration: discover -> fetch -> filter -> rank -> emit.
 *
 * Ported from the earlier Python implementation (removed; see CHANGELOG). Two behaviours here were bug fixes and must
 * not regress:
 *
 *  - Boards are keyed by (company, ATS, slug). Keying on (company, slug) made
 *    Ramp's two boards collide, reporting 1 posting instead of 169.
 *  - Transient failures are surfaced. Swallowing them made a DNS blip
 *    indistinguishable from "this company has no jobs".
 */

import { allAdapters, sharedDomainSiteTargets, type ATSAdapter, type BoardRead } from "./ats.js";
import { configFromEnv, type Config } from "./config.js";
import { discoverBoards } from "./discovery.js";
import {
  buildDiscoveryQuery,
  buildSiteQuery,
  expandTitles,
  filterJobs,
  rankJobs,
} from "./filtering.js";
import { stripHtml } from "./html.js";
import { summarizeHiring, type HiringSignal } from "./hiring-signal.js";
import type { Board, Job, PartialBoard, SearchProfile } from "./models.js";
import { makeJob, partialWarning } from "./models.js";
import { dedupeJobs, toJson, toMarkdown } from "./output.js";
import { buildProvider, SearchError, type SearchProvider } from "./search.js";

export interface RunResult {
  jobs: Job[];
  boards: Board[];
  companies: string[];
  warnings: string[];
  queries: string[];
  signals: HiringSignal[];
  raw_count: number;
  matched_count: number;
  /** Boards whose own total exceeds the postings read; totals are lower bounds. */
  partial_boards: PartialBoard[];
  /**
   * Why a run produced no jobs, when that is worth saying explicitly.
   *
   * "No postings matched, try widening titles" is actively wrong when the real
   * cause is that no board was readable and the search fallback had no key.
   * Naming the cause here lets the renderer give the actual remedy.
   */
  empty_reason: EmptyReason | null;
}

export type EmptyReason =
  | { kind: "no_key"; provider: string; variable: string; companies: string[] }
  | { kind: "no_board"; companies: string[] }
  | { kind: "filtered"; raw: number };

function emptyResult(): RunResult {
  return {
    jobs: [],
    boards: [],
    companies: [],
    warnings: [],
    queries: [],
    signals: [],
    raw_count: 0,
    matched_count: 0,
    partial_boards: [],
    empty_reason: null,
  };
}

/**
 * Stage-by-stage counts, so a zero result is diagnosable.
 *
 * `raw` > 0 with `matched` === 0 means the boards had postings but the profile
 * excluded them (widen the filters), not that discovery failed.
 */
export function meta(result: RunResult): Record<string, unknown> {
  return {
    "companies searched": result.companies.length,
    "live boards": result.boards.filter((b) => b.job_count > 0).length,
    "raw postings": result.raw_count,
    "matched postings": result.matched_count,
    returned: result.jobs.length,
    "queries offered": result.queries.length,
  };
}

/** Normalize the requested company names: dedupe (case-insensitive), then cap. */
export function resolveCompanies(result: RunResult, companies: string[], maxCompanies: number): void {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of companies) {
    const cleaned = name.split(/\s+/).filter(Boolean).join(" ");
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cleaned);
  }
  result.companies = unique.slice(0, maxCompanies);
}

interface ResolvedBoards {
  boards: Board[];
  byCompany: Map<string, Board[]>;
}

/** Discover boards for every company, keeping them grouped per company. */
async function resolveBoards(
  companies: string[],
  adapters: ATSAdapter[],
  result: RunResult,
): Promise<ResolvedBoards> {
  const boards: Board[] = [];
  const byCompany = new Map<string, Board[]>();
  for (const company of companies) byCompany.set(company, []);

  // One error sink per company: concurrent tasks must not share a list.
  const sinks = new Map<string, string[]>();
  for (const company of companies) sinks.set(company, []);

  await Promise.all(
    companies.map(async (company) => {
      try {
        const found = await discoverBoards(company, {
          adapters,
          errors: sinks.get(company),
        });
        byCompany.set(company, found);
        boards.push(...found);
      } catch (err) {
        result.warnings.push(`Could not look up ${company}: ${(err as Error)?.message ?? err}`);
      }
    }),
  );

  for (const sink of sinks.values()) result.warnings.push(...sink);

  boards.sort((a, b) => b.job_count - a.job_count);
  return { boards, byCompany };
}

/** Identity of one board. The ATS must be part of the key. */
/**
 * Boards whose own total is larger than what was read, e.g. SmartRecruiters
 * boards past the page cap. A board that reports no total, or failed to read,
 * is not listed here (its failure already produces a warning).
 */
export function partialBoards(live: Board[], reads: Map<string, BoardRead>): PartialBoard[] {
  const out: PartialBoard[] = [];
  for (const board of live) {
    const read = reads.get(boardKey(board));
    if (!read || read.reported === null) continue;
    if (read.jobs.length < read.reported) {
      out.push({
        company: board.company,
        ats: board.ats,
        read: read.jobs.length,
        reported: read.reported,
      });
    }
  }
  return out;
}

export function boardKey(board: Board): string {
  return `${board.company}\u0000${board.ats}\u0000${board.slug}`;
}

/** Fetch one board's postings, returning [] on failure but recording why. */
export async function fetchBoard(
  board: Board,
  adapters: ATSAdapter[],
  timeoutMs: number,
  errors?: string[],
): Promise<BoardRead> {
  const base = adapters.find((a) => a.name === board.ats);
  if (!base) return { jobs: [], reported: null };

  const adapter =
    base.timeout === timeoutMs ? base : new (base.constructor as new (t: number) => ATSAdapter)(timeoutMs);

  try {
    return await adapter.fetchRead(board.slug);
  } catch (err) {
    if (errors) {
      errors.push(
        `could not read ${board.company}'s ${board.ats} board ` +
          `(${(err as Error)?.name ?? "Error"}); counts may be understated`,
      );
    }
    return { jobs: [], reported: null };
  }
}

/** Fetch every live board, keyed by (company, ats, slug). */
async function fetchAll(
  live: Board[],
  adapters: ATSAdapter[],
  timeoutMs: number,
  result: RunResult,
): Promise<Map<string, BoardRead>> {
  const fetched = new Map<string, BoardRead>();
  const sinks = new Map<string, string[]>();
  for (const board of live) sinks.set(boardKey(board), []);

  await Promise.all(
    live.map(async (board) => {
      const key = boardKey(board);
      const sink = sinks.get(key);
      fetched.set(key, await fetchBoard(board, adapters, timeoutMs, sink));
    }),
  );

  for (const sink of sinks.values()) result.warnings.push(...sink);
  return fetched;
}

export interface RunSearchOptions {
  companies?: string[];
  maxCompanies?: number;
  config?: Config;
  adapters?: ATSAdapter[];
  provider?: SearchProvider | null;
  searchLimit?: number;
}

/** Search live ATS boards at the named companies for roles matching `profile`. */
export async function runSearch(
  profile: SearchProfile,
  options: RunSearchOptions = {},
): Promise<RunResult> {
  const config = options.config ?? configFromEnv();
  const adapters =
    options.adapters ?? allAdapters(config.http_timeout * 1000, config.cache_ttl, config.cache_dir);
  const result = emptyResult();

  resolveCompanies(result, options.companies ?? [], options.maxCompanies ?? 40);
  if (result.companies.length === 0) {
    result.warnings.push("No companies to search. Pass --company NAME.");
    return result;
  }

  const { boards } = await resolveBoards(result.companies, adapters, result);
  if (!result.boards) result.boards = [];
  result.boards = boards;

  const live = boards.filter((b) => b.job_count > 0);
  const fetched = await fetchAll(live, adapters, config.http_timeout * 1000, result);
  const raw: Job[] = [...fetched.values()].flatMap((r) => r.jobs);
  result.raw_count = raw.length;
  result.partial_boards = partialBoards(live, fetched);
  for (const p of result.partial_boards) {
    result.warnings.push(partialWarning(p));
  }

  // For companies with no live board, hand the agent a discovery query.
  const resolved = new Set(boards.map((b) => b.company));
  for (const name of result.companies) {
    if (!resolved.has(name)) result.queries.push(buildDiscoveryQuery(name));
  }

  // Offer boolean site: queries the agent can execute via the search API.
  if (profile.titles.length > 0) {
    const groups = expandTitles(profile.titles);
    for (const domain of sharedDomainSiteTargets()) {
      result.queries.push(buildSiteQuery(domain, groups, profile.locations));
    }
  }

  if (raw.length > 0) {
    const matched = filterJobs(raw, profile);
    result.matched_count = matched.length;
    result.jobs = rankJobs(dedupeJobs(matched), profile);
    if (result.jobs.length === 0) {
      result.empty_reason = { kind: "filtered", raw: raw.length };
      result.warnings.push(
        `${raw.length} open roles were found, but none matched your filters. ` +
          `Try a broader --title, a different --location, or remove --remote/--max-age-days.`,
      );
    }
  } else {
    result.jobs = await searchFallback(profile, result, config, options.provider ?? null, options.searchLimit ?? 15);
    if (result.jobs.length === 0 && result.empty_reason === null && live.length === 0) {
      result.empty_reason = { kind: "no_board", companies: result.companies };
    }
  }

  return result;
}

export interface CheckHiringOptions {
  recentDays?: number;
  maxCompanies?: number;
  config?: Config;
  adapters?: ATSAdapter[];
}

/**
 * Answer "is this company hiring, and for what?" for each named company.
 *
 * The supported successor to seeding from WARN filings: starts from a company
 * the user cares about and reports the live board, open-role count, recency and
 * the departments hiring most.
 */
export async function checkHiring(
  companies: string[],
  options: CheckHiringOptions = {},
): Promise<RunResult> {
  const config = options.config ?? configFromEnv();
  const adapters =
    options.adapters ?? allAdapters(config.http_timeout * 1000, config.cache_ttl, config.cache_dir);
  const result = emptyResult();

  resolveCompanies(result, companies, options.maxCompanies ?? 40);
  if (result.companies.length === 0) {
    result.warnings.push("No companies to check. Pass --check COMPANY.");
    return result;
  }

  const { boards, byCompany } = await resolveBoards(result.companies, adapters, result);
  result.boards = boards;

  const live = boards.filter((b) => b.job_count > 0);
  const fetched = await fetchAll(live, adapters, config.http_timeout * 1000, result);
  result.raw_count = [...fetched.values()].reduce((n, r) => n + r.jobs.length, 0);

  for (const name of result.companies) {
    const companyBoards = byCompany.get(name) ?? [];
    const companyJobs = companyBoards.flatMap((b) => fetched.get(boardKey(b))?.jobs ?? []);
    result.signals.push(
      summarizeHiring(name, companyBoards, companyJobs, { recentDays: options.recentDays ?? 30 }),
    );
    if (companyBoards.length === 0) result.queries.push(buildDiscoveryQuery(name));
  }

  return result;
}

/** Use the search engine when no ATS APIs produced postings. */
async function searchFallback(
  profile: SearchProfile,
  result: RunResult,
  config: Config,
  provider: SearchProvider | null,
  searchLimit: number,
): Promise<Job[]> {
  if (profile.titles.length === 0) return [];

  let active = provider;
  if (!active) {
    try {
      active = buildProvider(config);
    } catch (err) {
      result.warnings.push(`Search fallback skipped: ${(err as Error)?.message ?? err}`);
      result.empty_reason = {
        kind: "no_key",
        provider: config.search_provider,
        variable: "JOB_BOARD_SEARCH_API_KEY",
        companies: result.companies,
      };
      return [];
    }
  }

  const jobs: Job[] = [];
  for (const domain of sharedDomainSiteTargets().slice(0, 3)) {
    const query = buildSiteQuery(domain, expandTitles(profile.titles));
    try {
      const hits = await active.search(query, searchLimit);
      for (const hit of hits) {
        jobs.push(
          makeJob({
            title: hit.title,
            company: companyFromUrl(hit.url, hit.title),
            url: hit.url,
            source: "search",
            snippet: stripHtml(hit.snippet),
          }),
        );
      }
    } catch (err) {
      // An auth/quota error fails identically on every domain: stop rather than
      // emit the same warning three times and burn quota.
      result.warnings.push(err instanceof SearchError ? err.message : String(err));
      break;
    }
  }
  return dedupeJobs(jobs);
}

const AT = /\s+(?:at|@)\s+(.+)$/i;

/**
 * Best-effort company name for a search-sourced result.
 *
 * ATS slugs make poor display names ("andurilindustries", "sodali_co"), so
 * prefer the title, which usually ends "... at <Company>".
 */
export function companyFromUrl(url: string, title = ""): string {
  const match = AT.exec(title ?? "");
  if (match?.[1]) {
    let candidate = stripHtml(match[1]).replace(/^[\s.,\-_]+|[\s.,\-_]+$/g, "");
    candidate = candidate.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (candidate && candidate.length <= 60) return candidate;
  }

  const parts = url.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    if (part.includes(".") && i + 1 < parts.length) {
      const slug = stripHtml(parts[i + 1] as string).replace(/[_-]/g, " ");
      return slug
        .split(/\s+/)
        .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ");
    }
  }
  return "";
}

export { toJson, toMarkdown };
