/**
 * Human-facing renderers: compact Markdown, detailed per-finding blocks, and a
 * standalone HTML page.
 *
 * Emoji are used only here. They make a long list scannable for a person, and
 * they would corrupt data an agent parses -- so JSON stays plain.
 *
 * The vocabulary is deliberately small and semantic, not decorative: this output
 * may be read by someone who has just lost their job, and a wall of emoji would
 * read as unserious.
 */

import { displayCompany, friendlyDepartment, isPartial, verdict } from "./hiring-signal.js";
import type { HiringSignal } from "./hiring-signal.js";
import { daysSince, parseIso, resultHeadline, unreadableCompanies, type Board, type Job } from "./models.js";
import type { EmptyReason } from "./pipeline.js";

// ------------------------------------------------------------------- symbols

/** A finding is "fresh" within this many days. */
export const FRESH_DAYS = 14;
/** Beyond this, a posting is likely stale or reposted. */
export const STALE_DAYS = 180;

export const SYMBOLS = {
  remote: "🌍",
  salary: "💰",
  fresh: "🆕",
  stale: "🕸️",
  hot: "🔥",
  unreadable: "🚫",
} as const;

/** The badge for a company's hiring signal: unreadable, hiring recently, or none. */
export function hiringBadge(signal: HiringSignal): string {
  if (signal.unknown) return SYMBOLS.unreadable;
  return signal.hiring_recently ? SYMBOLS.hot : "";
}

/** Signals worth marking on one posting, in priority order. */
export function jobBadges(job: Job, now: Date = new Date()): string[] {
  const badges: string[] = [];
  if (job.remote) badges.push(SYMBOLS.remote);
  if (job.compensation) badges.push(SYMBOLS.salary);

  const posted = parseIso(job.posted_at);
  if (posted) {
    const age = daysSince(posted, now);
    if (age <= FRESH_DAYS) badges.push(SYMBOLS.fresh);
    else if (age >= STALE_DAYS) badges.push(SYMBOLS.stale);
  }
  return badges;
}

/** Human age string, or null when the date is unknown. */
export function ageLabel(job: Job, now: Date = new Date()): string | null {
  const posted = parseIso(job.posted_at);
  if (!posted) return null;
  const days = daysSince(posted, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function rule(width = 60): string {
  return "─".repeat(width);
}

export interface DetailOptions {
  boards?: Board[];
  meta?: Record<string, unknown>;
  limit?: number | null;
  emptyReason?: EmptyReason | null;
  /** Plain-text notes (partial reads, cache, warnings). */
  notes?: string[];
}

/**
 * One block per finding.
 *
 * The compact Markdown squeezes six facts onto a `·`-separated line, which is
 * fine for scanning 50 results and bad for the three you are actually going to
 * apply to. This format gives each posting room, with its link on its own line
 * so it is easy to copy out of a terminal.
 */
export function toDetail(jobs: Job[], options: DetailOptions = {}): string {
  const { boards = [], meta = {}, limit = null } = options;
  const now = new Date();
  const shown = limit !== null ? jobs.slice(0, limit) : jobs;

  const companies = [...new Set(jobs.map((j) => displayCompany(j.company)).filter(Boolean))].sort();
  const where =
    companies.slice(0, 4).join(", ") + (companies.length > 4 ? ` +${companies.length - 4} more` : "");
  const unreadable = unreadableCompanies(jobs.length, options.emptyReason);

  const lines: string[] = [];
  lines.push(`# ${unreadable ? SYMBOLS.unreadable : SYMBOLS.hot} ${resultHeadline(jobs.length, where, unreadable)}`);
  lines.push("");

  if (shown.length < jobs.length) {
    lines.push(`_Showing the first ${shown.length}. Raise \`--limit\` for more._`);
    lines.push("");
  }

  for (const note of options.notes ?? []) lines.push(note, "");

  if (shown.length === 0) {
    lines.push(...emptyBlock(options.emptyReason));
  }

  for (const job of shown) {
    const badges = jobBadges(job, now).join(" ");
    lines.push(rule());
    lines.push(`### ${job.title}${badges ? `  ${badges}` : ""}`);
    lines.push("");

    const facts: Array<[string, string]> = [
      ["Company", displayCompany(job.company)],
      ["Location", job.location || "not specified"],
    ];
    if (job.department) facts.push(["Team", job.department]);
    if (job.employment_type) facts.push(["Type", job.employment_type]);
    if (job.compensation) facts.push(["Pay", job.compensation]);
    const age = ageLabel(job, now);
    if (age) facts.push(["Posted", age]);

    for (const [label, value] of facts) {
      lines.push(`- **${label}:** ${value}`);
    }

    if (job.snippet) {
      lines.push("");
      lines.push(`> ${job.snippet}`);
    }

    lines.push("");
    if (job.url) {
      lines.push(`🔗 ${job.url}`);
      lines.push("");
    }
  }

  if (shown.length > 0) lines.push(rule());
  lines.push("");

  const live = boards.filter((b) => b.job_count > 0);
  if (live.length > 0 || Object.keys(meta).length > 0) {
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

  lines.push(
    `<sub>${SYMBOLS.remote} remote · ${SYMBOLS.salary} pay listed · ` +
      `${SYMBOLS.fresh} under ${FRESH_DAYS}d · ${SYMBOLS.stale} over ${STALE_DAYS}d</sub>`,
  );

  return lines.join("\n");
}

function emptyBlock(reason: EmptyReason | null | undefined): string[] {
  if (reason?.kind === "no_key") {
    const who = reason.companies.join(", ");
    const plural = reason.companies.length > 1;
    return [
      `${SYMBOLS.unreadable} No roles found for **${who}**. ` +
        `${plural ? "These companies use" : "This company uses"} a careers site this ` +
        `skill cannot read directly.`,
      "",
      `Set \`${reason.variable}\` (provider: ${reason.provider}) and re-run to search indexed job boards instead.`,
      "",
    ];
  }
  if (reason?.kind === "no_board") {
    return [
      `${SYMBOLS.unreadable} No job board found for ${reason.companies.join(", ")}.`,
      "",
      "Large employers use custom careers sites. Try a smaller company, or set " +
        "`JOB_BOARD_SEARCH_API_KEY` to search indexed boards.",
      "",
    ];
  }
  if (reason?.kind === "filtered") {
    // The advice is in the warnings block, from the pipeline. Repeating it printed the
    // same finding twice.
    return [];
  }
  return ["_No postings matched. Try widening titles/locations or dropping filters._", ""];
}


/**
 * Hiring report in the detail format.
 *
 * `--check --format detail` used to fall back to plain Markdown, silently
 * ignoring the requested format. Distinct output now: one block per company
 * with a department table. The table body is emitted only when there are
 * departments, so an unreadable company collapses to its verdict line.
 */
export function toHiringDetail(signals: HiringSignal[], queries: string[] = [], notes: string[] = []): string {
  const lines: string[] = [];
  lines.push(`# ${SYMBOLS.hot} Is this company hiring?`);
  lines.push("");
  for (const note of notes) lines.push(note, "");

  if (signals.length === 0) {
    lines.push("_No companies checked._");
    lines.push("");
  }

  for (const signal of signals) {
    const badge = hiringBadge(signal);
    lines.push(rule());
    lines.push(`### ${displayCompany(signal.company)}${badge ? `  ${badge}` : ""}`);
    lines.push("");
    lines.push(verdict(signal));
    lines.push("");

    if (signal.top_departments.length > 0) {
      lines.push("| Department | Open roles |");
      lines.push("|---|---|");
      for (const d of signal.top_departments.slice(0, 10)) {
        lines.push(`| ${friendlyDepartment(d.department)} | ${d.open_roles} |`);
      }
      if (isPartial(signal)) {
        lines.push("");
        lines.push(`_Most recent roles only; board reports ${signal.board_reported_roles}._`);
      }
      lines.push("");
    }
  }

  if (queries.length > 0) {
    lines.push(rule());
    lines.push("#### 🔗 Next step for the user: find the careers page");
    lines.push("");
    lines.push(`\`${queries[0]}\``);
    lines.push("");
  }

  lines.push(
    `<sub>${SYMBOLS.hot} hiring recently · ${SYMBOLS.unreadable} could not read</sub>`,
  );
  return lines.join("\n");
}
