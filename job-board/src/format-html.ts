/**
 * Standalone HTML renderer.
 *
 * Purpose: something you can send to another person. A self-contained file with
 * no scripts, no external assets and no tracking -- it opens from disk and works
 * offline.
 *
 * Everything interpolated is HTML-escaped. Job titles routinely contain `&`, `<`
 * and quotes (for example "Sodali & Co."), and an unescaped title would break the
 * page or inject markup.
 */

import { displayCompany } from "./hiring-signal.js";
import { parseIso, resultHeadline, unreadableCompanies, type Board, type Job } from "./models.js";
import type { EmptyReason } from "./pipeline.js";
import { SYMBOLS, ageLabel, jobBadges } from "./format-detail.js";
import type { HiringSignal } from "./hiring-signal.js";
import { friendlyDepartment, isPartial, verdict } from "./hiring-signal.js";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] as string);
}

export interface HtmlOptions {
  boards?: Board[];
  meta?: Record<string, unknown>;
  limit?: number | null;
  emptyReason?: EmptyReason | null;
  /** Plain-text notes (partial reads, cache, warnings). */
  notes?: string[];
  /** Page title; defaults to a summary of the result count. */
  title?: string;
}

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 46rem;
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #1a1a1a; background: #fff;
}
@media (prefers-color-scheme: dark) {
  body { color: #e6e6e6; background: #14161a; }
  .job { background: #1c1f26; border-color: #2c313b; }
  a { color: #7cb7ff; }
  .meta, .legend { color: #9aa4b2; }
}
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
.sub { color: #666; margin: 0 0 2rem; font-size: .95rem; }
.job {
  border: 1px solid #e2e2e2; border-radius: 10px; padding: 1rem 1.15rem;
  margin-bottom: 1rem; background: #fafafa;
}
.job h2 { font-size: 1.05rem; margin: 0 0 .6rem; line-height: 1.35; }
.job h2 a { text-decoration: none; }
.job h2 a:hover { text-decoration: underline; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .2rem .8rem; margin: 0; font-size: .92rem; }
dt { color: #666; }
dd { margin: 0; }
.badges { font-size: .95rem; margin-left: .3rem; }
.snippet { margin: .7rem 0 0; padding-left: .8rem; border-left: 3px solid #ddd; color: #555; font-size: .9rem; }
.meta, .legend { font-size: .8rem; color: #777; margin-top: 1.25rem; }
.legend { margin-top: 2rem; }
.empty { border: 1px dashed #ccc; border-radius: 10px; padding: 1.25rem; margin-bottom: 1rem; }
`;

/** Render a results page. Self-contained: no JS, no external requests. */
export function toHtml(jobs: Job[], options: HtmlOptions = {}): string {
  const { boards = [], meta = {}, limit = null, emptyReason = null, title } = options;
  const now = new Date();
  const shown = limit !== null ? jobs.slice(0, limit) : jobs;

  const companies = [...new Set(jobs.map((j) => displayCompany(j.company)).filter(Boolean))].sort();
  const where =
    companies.slice(0, 4).join(", ") + (companies.length > 4 ? ` +${companies.length - 4} more` : "");
  const unreadable = unreadableCompanies(jobs.length, options.emptyReason);
  const heading = title ?? resultHeadline(jobs.length, where, unreadable);

  const parts: string[] = [];
  parts.push("<!DOCTYPE html>");
  parts.push('<html lang="en">');
  parts.push("<head>");
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push(`<title>${escapeHtml(heading)}</title>`);
  parts.push(`<style>${STYLE}</style>`);
  parts.push("</head>");
  parts.push("<body>");
  const symbol = unreadable && !title ? SYMBOLS.unreadable : SYMBOLS.hot;
  parts.push(`<h1>${symbol} ${escapeHtml(heading)}</h1>`);

  for (const note of options.notes ?? []) {
    parts.push(`<p class="sub">${escapeHtml(note)}</p>`);
  }
  if (shown.length < jobs.length) {
    parts.push(`<p class="sub">Showing the first ${shown.length} of ${jobs.length}.</p>`);
  }

  if (shown.length === 0) {
    parts.push(`<div class="empty">${emptyHtml(emptyReason)}</div>`);
  }

  for (const job of shown) {
    const badges = jobBadges(job, now).join(" ");
    const age = ageLabel(job, now);
    const rows: Array<[string, string]> = [
      ["Company", escapeHtml(displayCompany(job.company))],
      ["Location", escapeHtml(job.location || "not specified")],
    ];
    if (job.department) rows.push(["Team", escapeHtml(job.department)]);
    if (job.employment_type) rows.push(["Type", escapeHtml(job.employment_type)]);
    if (job.compensation) rows.push(["Pay", escapeHtml(job.compensation)]);
    if (age) rows.push(["Posted", escapeHtml(age)]);

    parts.push('<article class="job">');
    const titleHtml = escapeHtml(job.title);
    const link = job.url
      ? `<a href="${escapeHtml(job.url)}" rel="noopener noreferrer">${titleHtml}</a>`
      : titleHtml;
    parts.push(`<h2>${link}${badges ? `<span class="badges">${badges}</span>` : ""}</h2>`);
    parts.push("<dl>");
    for (const [label, value] of rows) {
      parts.push(`<dt>${label}</dt><dd>${value}</dd>`);
    }
    parts.push("</dl>");
    if (job.snippet) {
      parts.push(`<p class="snippet">${escapeHtml(job.snippet)}</p>`);
    }
    parts.push("</article>");
  }

  const live = boards.filter((b) => b.job_count > 0);
  if (live.length > 0 || Object.keys(meta).length > 0) {
    const metaText = Object.entries(meta)
      .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
      .join(" · ");
    const boardText = live
      .map((b) => `${escapeHtml(displayCompany(b.company))} (${escapeHtml(b.ats)}, ${b.job_count})`)
      .join(", ");
    parts.push(
      `<p class="meta">${metaText}${metaText && boardText ? " · " : ""}` +
        `${boardText ? `Boards read: ${boardText}` : ""}</p>`,
    );
  }

  parts.push(
    `<p class="legend">${SYMBOLS.remote} remote · ${SYMBOLS.salary} pay listed · ` +
      `${SYMBOLS.fresh} new · ${SYMBOLS.stale} possibly stale</p>`,
  );
  parts.push("</body>");
  parts.push("</html>");
  return parts.join("\n");
}

function emptyHtml(reason: EmptyReason | null | undefined): string {
  if (reason?.kind === "no_key") {
    const who = escapeHtml(reason.companies.join(", "));
    const plural = reason.companies.length > 1;
    return (
      `${SYMBOLS.unreadable} No roles found for <strong>${who}</strong>. ` +
      `${plural ? "These companies use" : "This company uses"} a careers site this skill ` +
      `cannot read directly. ` +
      `Set <code>${escapeHtml(reason.variable)}</code> (provider: ` +
      `${escapeHtml(reason.provider)}) and re-run to search indexed job boards instead.`
    );
  }
  if (reason?.kind === "no_board") {
    return (
      `${SYMBOLS.unreadable} No job board found for ${escapeHtml(reason.companies.join(", "))}. ` +
      `Large employers use custom careers sites.`
    );
  }
  if (reason?.kind === "filtered") {
    return (
      `${reason.raw} open roles were found, but none matched. Try a broader title, ` +
      `another location, or drop the remote/age filters.`
    );
  }
  return "No postings matched. Try widening titles/locations or dropping filters.";
}


/**
 * Render a hiring report as a standalone page.
 *
 * `--check --format html` previously emitted Markdown, which silently ignored
 * what the caller asked for.
 */
export function toHiringHtml(signals: HiringSignal[], queries: string[] = [], notes: string[] = []): string {
  const parts: string[] = [];
  parts.push("<!DOCTYPE html>");
  parts.push('<html lang="en">');
  parts.push("<head>");
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push("<title>Is this company hiring?</title>");
  parts.push(`<style>${STYLE}</style>`);
  parts.push("</head>");
  parts.push("<body>");
  parts.push(`<h1>${SYMBOLS.hot} Is this company hiring?</h1>`);
  for (const note of notes) parts.push(`<p class="sub">${escapeHtml(note)}</p>`);
  parts.push("");

  if (signals.length === 0) parts.push('<p class="sub">No companies checked.</p>');

  for (const signal of signals) {
    const badge = signal.unknown
      ? SYMBOLS.unreadable
      : signal.hiring_recently
        ? SYMBOLS.hot
        : "";
    parts.push('<article class="job">');
    parts.push(
      `<h2>${escapeHtml(displayCompany(signal.company))}` +
        (badge ? `<span class="badges">${badge}</span>` : "") +
        "</h2>",
    );
    parts.push(`<p>${escapeHtml(verdict(signal))}</p>`);

    if (signal.top_departments.length > 0) {
      parts.push("<table><thead><tr><th>Department</th><th>Open roles</th></tr></thead><tbody>");
      for (const d of signal.top_departments.slice(0, 10)) {
        parts.push(
          `<tr><td>${escapeHtml(friendlyDepartment(d.department))}</td>` +
            `<td>${d.open_roles}</td></tr>`,
        );
      }
      parts.push("</tbody></table>");
    }
    parts.push("</article>");
  }

  if (queries.length > 0) {
    parts.push('<p class="meta">Next step for the user: search for the careers page —');
    parts.push(`<code>${escapeHtml(queries[0] as string)}</code></p>`);
  }

  parts.push(
    `<p class="legend">${SYMBOLS.hot} hiring recently · ${SYMBOLS.unreadable} could not read</p>`,
  );
  parts.push("</body>");
  parts.push("</html>");
  return parts.join("\n");
}
