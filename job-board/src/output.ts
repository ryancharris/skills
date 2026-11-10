/**
 * Serialization: dedupe plus JSON and Markdown renderers.
 *
 * Ported from jobsearch/output.py. The JSON key set and ordering are part of the
 * public contract an agent parses, so they must match the Python output.
 */

import { displayCompany, friendlyDepartment, isPartial, verdict } from "./hiring-signal.js";
import { FRESH_DAYS, STALE_DAYS, SYMBOLS, hiringBadge, jobBadges } from "./format-detail.js";
import type { HiringSignal } from "./hiring-signal.js";
import { daysSince, parseIso, type Board, type Job, type PartialBoard } from "./models.js";
import type { EmptyReason } from "./pipeline.js";

// --------------------------------------------------------------------- dedupe

/** Repost identity: normalised title + company + location. */
function contentKey(job: Job): string {
  const title = job.title.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  return `${title}\u0000${job.company.toLowerCase()}|${job.location.toLowerCase()}`;
}

/**
 * Collapse the same posting seen on multiple sources.
 *
 * Only cross-source duplicates are collapsed. Within a single board, two
 * postings with distinct provider ids are distinct openings and must both
 * survive -- collapsing them would silently hide real jobs (Stripe posts several
 * separate "Software Engineer" openings in Seattle).
 */
export function dedupeJobs(jobs: Job[]): Job[] {
  const groups = new Map<string, Job[]>();
  const order: string[] = [];
  const seenIds = new Set<string>();

  for (const job of jobs) {
    const sid = `${job.source}\u0000${job.company}:${job.identifier || job.url}`.toLowerCase();
    if (seenIds.has(sid)) continue; // exact re-emission of the same posting
    seenIds.add(sid);

    const key = contentKey(job);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, [job]);
      order.push(key);
      continue;
    }

    const sameSource = existing.filter((j) => j.source === job.source);
    if (sameSource.length > 0) {
      const distinct = sameSource.every(
        (other) => job.identifier && other.identifier && job.identifier !== other.identifier,
      );
      if (distinct) existing.push(job); // genuinely different opening
      continue;
    }

    // Cross-source repost: keep one, preferring a dated record from the origin
    // board over an undated aggregator repost.
    const incumbent = existing[0] as Job;
    if (
      (job.posted_at && !incumbent.posted_at) ||
      job.location.length > incumbent.location.length
    ) {
      existing[0] = job;
    }
  }

  const out: Job[] = [];
  for (const key of order) out.push(...(groups.get(key) as Job[]));
  return out;
}

// ----------------------------------------------------------------------- JSON

/**
 * ISO-8601 timestamp matching Python's `datetime.now(timezone.utc).isoformat()`.
 *
 * Not `toISOString()`: that emits milliseconds and a `Z` suffix, whereas Python
 * emits microseconds and `+00:00`. Both are valid ISO-8601, but `generated_at`
 * is part of the JSON an agent may compare, so the format is kept identical.
 */
function isoLikePython(date: Date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const micros = pad(date.getUTCMilliseconds() * 1000, 6);
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}` +
    `.${micros}+00:00`
  );
}

const COMPACT_DROP_IF_FALSY = [
  "remote",
  "department",
  "employment_type",
  "posted_at",
  "compensation",
  "snippet",
];

/** Always dropped in compact mode: redundant, not merely empty. */
const COMPACT_ALWAYS_DROP = ["identifier"];

export interface JsonOptions {
  boards?: Board[];
  meta?: Record<string, unknown>;
  queries?: string[];
  warnings?: string[];
  /** How many matched before --limit. Defaults to jobs.length. */
  total?: number;
  compact?: boolean;
  /** Machine-readable reason a result is empty; null when it is not. */
  emptyReason?: EmptyReason | null;
  /** Boards read incompletely; `partial` in the output is true when any exist. */
  partialBoards?: PartialBoard[];
  /** True when any ATS response used came from the cache. */
  cached?: boolean;
  /** Oldest fetch time of the responses used (ISO 8601), or null. */
  fetchedAt?: string | null;
}

/**
 * Serialize a role search.
 *
 * `count` is how many jobs are IN THIS PAYLOAD; `total` is how many matched
 * before --limit. Both are given because an agent that reads only `count` would
 * report "3 roles" for a company with 9 and would not know to re-run.
 */
export function toJson(jobs: Job[], options: JsonOptions = {}): string {
  const { boards = [], meta = {}, queries = [], warnings = [], compact = false } = options;
  const partialBoards = options.partialBoards ?? [];
  const total = options.total ?? jobs.length;

  const jobDicts = jobs.map((job) => {
    const record: Record<string, unknown> = { ...job };
    if (compact) {
      for (const key of Object.keys(record)) {
        if (COMPACT_ALWAYS_DROP.includes(key)) {
          delete record[key];
          continue;
        }
        if (COMPACT_DROP_IF_FALSY.includes(key) && !record[key]) delete record[key];
      }
    }
    return record;
  });

  const payload = {
    generated_at: isoLikePython(),
    fetched_at: options.fetchedAt ?? null,
    cached: options.cached ?? false,
    count: jobs.length,
    total,
    truncated: jobs.length < total,
    partial: partialBoards.length > 0,
    partial_boards: partialBoards,
    meta,
    warnings,
    // Structured so an agent need not parse the warning text to learn why.
    empty_reason: options.emptyReason ?? null,
    boards: boards.map((b) => ({ ...b })),
    queries,
    jobs: jobDicts,
  };
  return JSON.stringify(payload, null, 2);
}

export interface HiringJsonOptions {
  queries?: string[];
  warnings?: string[];
  cached?: boolean;
  fetchedAt?: string | null;
}

/** Serialize hiring signals for agent consumption. */
export function toHiringJson(signals: HiringSignal[], options: HiringJsonOptions = {}): string {
  const { queries = [], warnings = [] } = options;
  const payload = {
    generated_at: isoLikePython(),
    fetched_at: options.fetchedAt ?? null,
    cached: options.cached ?? false,
    count: signals.length,
    total: signals.length,
    truncated: false,
    warnings,
    queries,
    signals: signals.map((s) => ({
      company: s.company,
      open_roles: s.open_roles,
      board_count: s.board_count,
      recent_roles: s.recent_roles,
      recent_days: s.recent_days,
      hiring_recently: s.hiring_recently,
      top_departments: s.top_departments.map((d) => ({
        department: d.department,
        open_roles: d.open_roles,
      })),
      boards: s.boards.map((b) => ({ ...b })),
      unknown: s.unknown,
      partial: isPartial(s),
      board_reported_roles: s.board_reported_roles,
      verdict: verdict(s),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

// ------------------------------------------------------------------- Markdown

export interface MarkdownOptions {
  boards?: Board[];
  meta?: Record<string, unknown>;
  limit?: number | null;
  /** Why the result is empty, so the remedy can be specific. */
  emptyReason?: EmptyReason | null;
  /** Plain-text notes (partial reads, cache, warnings) for the human formats. */
  notes?: string[];
}

/**
 * Human-readable role search.
 *
 * Jobs appear in the first screenful: the old layout led with ~18 lines of
 * metadata and an ATS table, so the reader scrolled past noise to reach the
 * thing they asked for. Diagnostics go last.
 */
/** Escape characters that would break a Markdown link label. */
export function mdEscapeText(text: string): string {
  return text.replace(/([\\[\]])/g, "\\$1");
}

/** Encode characters that would end a Markdown link destination early. */
export function mdUrl(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

export function toMarkdown(jobs: Job[], options: MarkdownOptions = {}): string {
  const { boards = [], meta = {}, limit = null } = options;
  const now = new Date();
  const shown = limit !== null ? jobs.slice(0, limit) : jobs;

  const companies = [...new Set(jobs.map((j) => displayCompany(j.company)).filter(Boolean))].sort();
  const where =
    companies.slice(0, 4).join(", ") +
    (companies.length > 4 ? ` +${companies.length - 4} more` : "");
  const noun = jobs.length === 1 ? "role" : "roles";
  const headline = `# ${jobs.length} ${noun}${where ? ` at ${where}` : ""}`;

  const lines: string[] = [headline, ""];
  for (const note of options.notes ?? []) lines.push(note, "");

  if (shown.length < jobs.length) {
    lines.push(`_Showing the first ${shown.length}. Raise \`--limit\` for more._`);
    lines.push("");
  }

  if (shown.length === 0) {
    // "Try widening your filters" is wrong advice when nothing could be read in
    // the first place. Say what actually happened and what would help.
    const reason = options.emptyReason;
    if (reason?.kind === "no_key") {
      const who = reason.companies.join(", ");
      const plural = reason.companies.length > 1;
      lines.push(
        `No roles found for **${who}**. ${plural ? "These companies use" : "This company uses"} ` +
          `a careers site this skill cannot read directly, and the search fallback ` +
          `needs an API key.`,
      );
      lines.push("");
      lines.push(
        `Export \`${reason.variable}\` (provider: ${reason.provider}) and re-run to ` +
          `search indexed job boards instead.`,
      );
    } else if (reason?.kind === "no_board") {
      lines.push(
        `No job board found for ${reason.companies.join(", ")}. Large employers use ` +
          `custom careers sites; try a smaller company, or set ` +
          `\`LAID_OFF_SEARCH_API_KEY\` to search indexed boards.`,
      );
    } else if (reason?.kind === "filtered") {
      lines.push(
        `${reason.raw} open roles were found, but none matched. Try a broader ` +
          `--title, another --location, or drop --remote/--max-age-days.`,
      );
    } else {
      lines.push("_No postings matched. Try widening titles/locations or dropping filters._");
    }
    lines.push("");
  }

  if (shown.length > 0) {
    lines.push(
      `_${SYMBOLS.remote} remote · ${SYMBOLS.salary} pay listed · ` +
        `${SYMBOLS.fresh} under ${FRESH_DAYS}d · ${SYMBOLS.stale} over ${STALE_DAYS}d_`,
    );
    lines.push("");
  }

  for (const job of shown) {
    const posted = parseIso(job.posted_at);
    const freshness = posted ? ` · ${daysSince(posted, now)}d ago` : "";
    const remote = job.remote ? " · remote" : "";
    const loc = job.location ? ` · ${job.location}` : "";
    const comp = job.compensation ? ` · ${job.compensation}` : "";
    // `detail` shows Team and Type; `md` omitted them, so switching format
    // silently changed which facts existed. Compact forms go on the same line.
    const dept = job.department ? ` · ${job.department}` : "";
    const kind = job.employment_type ? ` · ${job.employment_type}` : "";

    const badges = jobBadges(job, now);
    const lead = badges.length > 0 ? `${badges.join(" ")} ` : "";
    const heading = job.url
      ? `[${mdEscapeText(job.title)}](${mdUrl(job.url)})`
      : mdEscapeText(job.title);
    lines.push(`### ${lead}${heading}`);
    lines.push(`${displayCompany(job.company)}${loc}${remote}${dept}${kind}${comp}${freshness}`);
    if (job.snippet) {
      lines.push("");
      lines.push(`> ${job.snippet}`);
    }
    lines.push("");
  }

  // Diagnostics last: useful when something looks wrong, distracting otherwise.
  const live = boards.filter((b) => b.job_count > 0);
  if (live.length > 0 || Object.keys(meta).length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("<sub>Diagnostics</sub>");
    lines.push("");
    const metaParts = Object.entries(meta).map(([k, v]) => `${k}: **${v}**`);
    if (metaParts.length > 0) {
      lines.push(metaParts.join(", "));
      lines.push("");
    }
    if (live.length > 0) {
      lines.push(
        "Boards read: " +
          live.map((b) => `${displayCompany(b.company)} (${b.ats}, ${b.job_count})`).join(", "),
      );
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** Human-readable hiring report. */
export function toHiringMarkdown(signals: HiringSignal[], queries: string[] = [], notes: string[] = []): string {
  const lines: string[] = ["# Is this company hiring?", ""];
  for (const note of notes) lines.push(note, "");

  if (signals.length === 0) lines.push("_No companies checked._");

  for (const signal of signals) {
    const badge = hiringBadge(signal);
    lines.push(`## ${displayCompany(signal.company)}${badge ? ` ${badge}` : ""}`);
    lines.push("");
    lines.push(verdict(signal));
    lines.push("");
    if (signal.top_departments.length > 0) {
      lines.push("| Department | Open roles |");
      lines.push("|---|---|");
      for (const dept of signal.top_departments.slice(0, 10)) {
        lines.push(`| ${friendlyDepartment(dept.department)} | ${dept.open_roles} |`);
      }
      lines.push("");
    }
  }

  if (queries.length > 0) {
    lines.push("## Next step: find the careers page yourself");
    lines.push("");
    lines.push("Paste this into a search engine to locate the company's board:");
    lines.push("");
    lines.push(`> ${queries[0]}`);
    lines.push("");
    if (queries.length > 1) {
      lines.push("Other boards to check directly:");
      lines.push("");
      for (const query of queries.slice(1)) lines.push(`- \`${query}\``);
      lines.push("");
    }
  }

  return lines.join("\n");
}
