/**
 * Shared data types for the laid-off skill.
 *
 * Ported from jobsearch/models.py. Field names are part of the public JSON
 * contract, so they must match the Python implementation exactly.
 */
export function emptyProfile() {
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
export function makeJob(partial) {
    return {
        title: oneLine(partial.title, TITLE_MAX),
        company: oneLine(partial.company),
        url: httpUrl(partial.url),
        source: partial.source,
        location: oneLine(partial.location ?? ""),
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
export function parseIso(value) {
    if (!value)
        return null;
    let text = value.trim();
    if (text === "")
        return null;
    if (text.endsWith("Z"))
        text = text.slice(0, -1) + "+00:00";
    const ms = Date.parse(text);
    if (Number.isNaN(ms))
        return null;
    return new Date(ms);
}
/** Whole days between an instant and now, floored at 0. */
export function daysSince(when, now) {
    return Math.max(0, Math.floor((now.getTime() - when.getTime()) / 86_400_000));
}
/**
 * Dedupe key for a posting.
 *
 * Mirrors Python's `Job.dedupe_key()`: prefer the provider id within a board,
 * else the normalised URL.
 */
export function dedupeKey(job) {
    if (job.identifier) {
        return `${job.source}\u0000${job.company}:${job.identifier}`.toLowerCase();
    }
    return `${job.source}\u0000${job.url.replace(/\/+$/, "")}`.toLowerCase();
}
/** One plain-text line per partial board, for the non-JSON formats. */
export function partialLines(boards) {
    return boards.map((b) => `Partial: ${b.company}'s ${b.ats} board has ${b.reported} postings but only ${b.read} were read. Results for this company are incomplete.`);
}
/** Longest title kept. ATS titles are short; a longer one is noise or a payload. */
export const TITLE_MAX = 200;
/** Longest search snippet kept, for the same reason. */
export const SNIPPET_MAX = 300;
/**
 * Collapse all whitespace (newlines included) so the text stays on one line,
 * then cap its length in characters. Over the cap, the text is cut with an ellipsis.
 */
export function oneLine(text, max = Infinity) {
    const flat = text.replace(/\s+/g, " ").trim();
    const chars = [...flat];
    if (chars.length <= max)
        return flat;
    return `${chars.slice(0, max - 1).join("")}\u2026`;
}
/** Keep only http(s) URLs. Anything else (javascript:, data:, relative) becomes "". */
export function httpUrl(url) {
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}
