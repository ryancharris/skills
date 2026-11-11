/**
 * Serialization: dedupe plus JSON and Markdown renderers.
 *
 * Ported from the earlier Python implementation (removed; see CHANGELOG). The JSON key set and ordering are part of the
 * public contract an agent parses, so they must match the Python output.
 */
import { displayCompany, friendlyDepartment, signalToDict, verdict } from "./hiring-signal.js";
import { FRESH_DAYS, STALE_DAYS, SYMBOLS, hiringBadge, jobBadges } from "./format-detail.js";
import { daysSince, parseIso, resultHeadline, unreadableCompanies } from "./models.js";
// --------------------------------------------------------------------- dedupe
/** Repost identity: normalised title + company + location. */
function contentKey(job) {
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
export function dedupeJobs(jobs) {
    const groups = new Map();
    const order = [];
    const seenIds = new Set();
    for (const job of jobs) {
        const sid = `${job.source}\u0000${job.company}:${job.identifier || job.url}`.toLowerCase();
        if (seenIds.has(sid))
            continue; // exact re-emission of the same posting
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
            const distinct = sameSource.every((other) => job.identifier && other.identifier && job.identifier !== other.identifier);
            if (distinct)
                existing.push(job); // genuinely different opening
            continue;
        }
        // Cross-source repost: keep one, preferring a dated record from the origin
        // board over an undated aggregator repost.
        const incumbent = existing[0];
        if ((job.posted_at && !incumbent.posted_at) ||
            job.location.length > incumbent.location.length) {
            existing[0] = job;
        }
    }
    const out = [];
    for (const key of order)
        out.push(...groups.get(key));
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
function isoLikePython(date = new Date()) {
    const pad = (n, width = 2) => String(n).padStart(width, "0");
    const micros = pad(date.getUTCMilliseconds() * 1000, 6);
    return (`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
        `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}` +
        `.${micros}+00:00`);
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
/**
 * Serialize a role search.
 *
 * `count` is how many jobs are IN THIS PAYLOAD; `total` is how many matched
 * before --limit. Both are given because an agent that reads only `count` would
 * report "3 roles" for a company with 9 and would not know to re-run.
 */
export function toJson(jobs, options = {}) {
    const { boards = [], meta = {}, queries = [], warnings = [], compact = false } = options;
    const partialBoards = options.partialBoards ?? [];
    const total = options.total ?? jobs.length;
    const jobDicts = jobs.map((job) => {
        const record = { ...job };
        if (compact) {
            for (const key of Object.keys(record)) {
                if (COMPACT_ALWAYS_DROP.includes(key)) {
                    delete record[key];
                    continue;
                }
                if (COMPACT_DROP_IF_FALSY.includes(key) && !record[key])
                    delete record[key];
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
/** Serialize hiring signals for agent consumption. */
export function toHiringJson(signals, options = {}) {
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
        // One definition of a signal's JSON: signalToDict. toHiringJson used to repeat it
        // here, and the two drifted (unknown counts were 0 in the CLI but null in the dict).
        signals: signals.map((s) => signalToDict(s)),
    };
    return JSON.stringify(payload, null, 2);
}
/**
 * Human-readable role search.
 *
 * Jobs appear in the first screenful: the old layout led with ~18 lines of
 * metadata and an ATS table, so the reader scrolled past noise to reach the
 * thing they asked for. Diagnostics go last.
 */
/** Escape characters that would break a Markdown link label. */
export function mdEscapeText(text) {
    return text.replace(/([\\[\]])/g, "\\$1");
}
/** Encode characters that would end a Markdown link destination early. */
export function mdUrl(url) {
    return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}
export function toMarkdown(jobs, options = {}) {
    const { boards = [], meta = {}, limit = null } = options;
    const now = new Date();
    const shown = limit !== null ? jobs.slice(0, limit) : jobs;
    const companies = [...new Set(jobs.map((j) => displayCompany(j.company)).filter(Boolean))].sort();
    const where = companies.slice(0, 4).join(", ") +
        (companies.length > 4 ? ` +${companies.length - 4} more` : "");
    const headline = `# ${resultHeadline(jobs.length, where, unreadableCompanies(jobs.length, options.emptyReason))}`;
    const lines = [headline, ""];
    for (const note of options.notes ?? [])
        lines.push(note, "");
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
            lines.push(`No roles found for **${who}**. ${plural ? "These companies use" : "This company uses"} ` +
                `a careers site this skill cannot read directly.`);
            lines.push("");
            lines.push(`Set \`${reason.variable}\` (provider: ${reason.provider}) and re-run to ` +
                `search indexed job boards instead.`);
        }
        else if (reason?.kind === "no_board") {
            lines.push(`No job board found for ${reason.companies.join(", ")}. Large employers use ` +
                `custom careers sites; try a smaller company, or set ` +
                `\`JOB_BOARD_SEARCH_API_KEY\` to search indexed boards.`);
        }
        else if (reason?.kind === "filtered") {
            // The advice is already in the warnings block above, from the pipeline. Saying
            // it again here printed the same finding twice.
        }
        else {
            lines.push("_No postings matched. Try widening titles/locations or dropping filters._");
        }
        if (reason?.kind !== "filtered")
            lines.push("");
    }
    if (shown.length > 0) {
        lines.push(`_${SYMBOLS.remote} remote · ${SYMBOLS.salary} pay listed · ` +
            `${SYMBOLS.fresh} under ${FRESH_DAYS}d · ${SYMBOLS.stale} over ${STALE_DAYS}d_`);
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
            lines.push("Boards read: " +
                live.map((b) => `${displayCompany(b.company)} (${b.ats}, ${b.job_count})`).join(", "));
            lines.push("");
        }
    }
    return lines.join("\n");
}
/** Human-readable hiring report. */
export function toHiringMarkdown(signals, queries = [], notes = []) {
    const lines = ["# Is this company hiring?", ""];
    for (const note of notes)
        lines.push(note, "");
    if (signals.length === 0)
        lines.push("_No companies checked._");
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
        lines.push("## Next step for the user: find the careers page");
        lines.push("");
        lines.push("The user can search for the company's board with this query:");
        lines.push("");
        lines.push(`> ${queries[0]}`);
        lines.push("");
        if (queries.length > 1) {
            lines.push("Other boards to check directly:");
            lines.push("");
            for (const query of queries.slice(1))
                lines.push(`- \`${query}\``);
            lines.push("");
        }
    }
    return lines.join("\n");
}
