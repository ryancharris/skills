/**
 * Shared data types for the job-search skill.
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
