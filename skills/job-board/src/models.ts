/**
 * Shared data types for the job-board skill.
 *
 * Ported from the earlier Python implementation (removed; see CHANGELOG). Field names are part of the public JSON
 * contract, so they must match the Python implementation exactly.
 */

export type JobSource =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "bamboohr"
  | "search";

export interface Job {
  title: string;
  company: string;
  url: string;
  source: JobSource;
  location: string;
  remote: boolean | null;
  department: string;
  employment_type: string;
  /** ISO-8601 string, best effort. */
  posted_at: string | null;
  compensation: string | null;
  /** Provider id, used for dedupe within a board. */
  identifier: string;
  /** Only set for search-sourced results. */
  snippet: string;
}

export interface Board {
  company: string;
  ats: string;
  slug: string;
  job_count: number;
  url: string;
}

export interface SearchProfile {
  titles: string[];
  locations: string[];
  remote_only: boolean;
  seniority: string[];
  include_keywords: string[];
  exclude_keywords: string[];
  exclude_companies: string[];
  max_age_days: number | null;
}

export function emptyProfile(): SearchProfile {
  return {
    titles: [],
    locations: [],
    remote_only: false,
    seniority: [],
    include_keywords: [],
    exclude_keywords: [],
    exclude_companies: [],
    max_age_days: null,
  };
}

/**
 * Build a Job with every field populated, in the canonical key order.
 *
 * Order is part of the JSON contract an agent parses: the Python implementation
 * emitted title, company, url, ... and a stable order lets a model learn the
 * schema once. Spreading defaults first would put the optional fields ahead of
 * the required ones, which is what this explicit construction avoids.
 */
export function makeJob(
  partial: Partial<Job> & { title: string; company: string; url: string; source: JobSource },
): Job {
  return {
    title: oneLine(partial.title, TITLE_MAX),
    company: oneLine(partial.company),
    url: httpUrl(partial.url),
    source: partial.source,
    location: tidyLocation(partial.location ?? ""),
    remote: partial.remote ?? null,
    department: oneLine(partial.department ?? ""),
    employment_type: oneLine(partial.employment_type ?? ""),
    posted_at: partial.posted_at ?? null,
    compensation: typeof partial.compensation === "string" ? oneLine(partial.compensation) : null,
    identifier: partial.identifier ?? "",
    snippet: oneLine(partial.snippet ?? "", SNIPPET_MAX),
  };
}

/**
 * Parse the assorted ISO-8601 timestamps the ATSes return.
 *
 * Returns null on anything unparseable rather than throwing: freshness is a
 * nice-to-have and must never break a run.
 */
export function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  let text = value.trim();
  if (text === "") return null;
  if (text.endsWith("Z")) text = text.slice(0, -1) + "+00:00";
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

/** Whole days between an instant and now, floored at 0. */
export function daysSince(when: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - when.getTime()) / 86_400_000));
}

/**
 * Dedupe key for a posting.
 *
 * Mirrors Python's `Job.dedupe_key()`: prefer the provider id within a board,
 * else the normalised URL.
 */
export function dedupeKey(job: Job): string {
  if (job.identifier) {
    return `${job.source}\u0000${job.company}:${job.identifier}`.toLowerCase();
  }
  return `${job.source}\u0000${job.url.replace(/\/+$/, "")}`.toLowerCase();
}

/** An ATS board the skill can read. */
export interface BoardResult {
  boards: Board[];
}

/** A board whose own total is larger than the number of postings read. */
export interface PartialBoard {
  company: string;
  ats: string;
  read: number;
  reported: number;
}

/** The warning text for a partial board. Shared so the notes can drop the duplicate. */
export function partialWarning(p: PartialBoard): string {
  return `${p.company}'s ${p.ats} board has ${p.reported} postings but only ${p.read} were read; results for this company are incomplete.`;
}

export interface NoteInput {
  partialBoards?: PartialBoard[];
  warnings?: string[];
  cached?: boolean;
  /** Oldest fetch time (ISO 8601) of the responses used, when cached. */
  fetchedAt?: string | null;
}

/**
 * Plain-text notes for the human formats (md, detail, html). They carry the same
 * facts as the JSON fields, so a person sees what an agent is told: a partial
 * read, cached data, and any warnings. Each partial board appears once, as a
 * "Partial:" line, not again among the warnings.
 */
export function noteLines(input: NoteInput): string[] {
  const partials = input.partialBoards ?? [];
  const lines: string[] = partials.map(
    (p) =>
      `Partial: ${p.company}'s ${p.ats} board has ${p.reported} postings but only ${p.read} were read. Results for this company are incomplete.`,
  );
  if (input.cached) {
    const asOf = input.fetchedAt ?? "unknown time";
    lines.push(
      `Cached: some board data came from the cache (oldest fetch ${asOf}). Check that time before saying the data is current.`,
    );
  }
  const partialTexts = new Set(partials.map(partialWarning));
  for (const warning of new Set(input.warnings ?? [])) {
    if (!partialTexts.has(warning)) lines.push(warning);
  }
  return lines;
}

/** Longest title kept. ATS titles are short; a longer one is noise or a payload. */
export const TITLE_MAX = 200;
/** Longest search snippet kept, for the same reason. */
export const SNIPPET_MAX = 300;

/**
 * Collapse all whitespace (newlines included) so the text stays on one line,
 * then cap its length in characters. Over the cap, the text is cut with an ellipsis.
 */
/**
 * Tidy a location from an ATS: drop empty comma-separated parts and collapse
 * whitespace. SmartRecruiters sends "Hyderabad, , India" for a city with no
 * region; this returns "Hyderabad, India". Other parts are left as the ATS sent
 * them.
 */
export function tidyLocation(text: string): string {
  return oneLine(text)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(", ");
}

export function oneLine(text: string, max = Infinity): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return `${chars.slice(0, max - 1).join("")}\u2026`;
}

/** Keep only http(s) URLs. Anything else (javascript:, data:, relative) becomes "". */
export function httpUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

/**
 * Companies whose board could not be read, when a run found nothing for that
 * reason. A headline of "0 roles" would then state a fact about the company that
 * is false: nothing was read. Null for every other case, including "filtered",
 * where roles existed and none matched, so "0 roles" is accurate.
 */
export function unreadableCompanies(
  count: number,
  reason: { kind: string; companies?: string[] } | null | undefined,
): string[] | null {
  if (count !== 0 || !reason) return null;
  if (reason.kind !== "no_key" && reason.kind !== "no_board") return null;
  return reason.companies && reason.companies.length > 0 ? reason.companies : null;
}

/** The headline for a result: a count, or what could not be read. */
export function resultHeadline(count: number, where: string, unreadable: string[] | null): string {
  if (unreadable) {
    const names = unreadable.join(", ");
    return `Could not read the job board${unreadable.length > 1 ? "s" : ""} for ${names}`;
  }
  const noun = count === 1 ? "role" : "roles";
  return `${count} ${noun}${where ? ` at ${where}` : ""}`;
}

