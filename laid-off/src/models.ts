/**
 * Shared data types for the laid-off skill.
 *
 * Ported from jobsearch/models.py. Field names are part of the public JSON
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
    title: partial.title,
    company: partial.company,
    url: partial.url,
    source: partial.source,
    location: partial.location ?? "",
    remote: partial.remote ?? null,
    department: partial.department ?? "",
    employment_type: partial.employment_type ?? "",
    posted_at: partial.posted_at ?? null,
    compensation: partial.compensation ?? null,
    identifier: partial.identifier ?? "",
    snippet: partial.snippet ?? "",
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
