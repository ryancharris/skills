/**
 * Post-layoff hiring signal: "they cut staff -- are they still hiring?"
 *
 * Ported from the earlier Python implementation (removed; see CHANGELOG). The design rationale is preserved
 * there and in references/layoff-data.md: an earlier version seeded searches
 * from WARN filings, which failed because WARN cannot express "tech" and its
 * largest filers resolve on none of the supported ATSes.
 */
import { daysSince, parseIso } from "./models.js";
/** Vendor department names that read as insider jargon to a job seeker. */
const DEPARTMENT_ALIASES = {
    gtm: "Sales & Marketing",
    "go-to-market": "Sales & Marketing",
    // OpenAI writes this one with spaces and capitals; the map lookup is
    // case-insensitive but the spacing has to match.
    "go to market": "Sales & Marketing",
    unspecified: "Other / unlabelled",
};
/** Expand department names a normal reader would not recognise. */
export function friendlyDepartment(department) {
    return DEPARTMENT_ALIASES[department.trim().toLowerCase()] ?? department;
}
/**
 * Brands whose capitalisation plain title-casing would mangle.
 *
 * Ashby exposes no company name, so the slug is displayed. "openai" title-cased
 * becomes "Openai", which looks wrong to anyone who works there.
 */
const BRAND_NAMES = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    cohere: "Cohere",
    notion: "Notion",
    stripe: "Stripe",
    ramp: "Ramp",
    figma: "Figma",
    linear: "Linear",
    huggingface: "Hugging Face",
    togetherai: "Together AI",
    poolside: "Poolside",
    mistral: "Mistral",
    elevenlabs: "ElevenLabs",
    anyscale: "Anyscale",
    vercel: "Vercel",
    railway: "Railway",
    retool: "Retool",
    databricks: "Databricks",
    snowflake: "Snowflake",
    duolingo: "Duolingo",
    instacart: "Instacart",
    doordash: "DoorDash",
    robinhood: "Robinhood",
    coinbase: "Coinbase",
    scale: "Scale AI",
    vendor: "Vendor",
};
/**
 * Present a company name the way a person writes it.
 *
 * Order: known brand, then a name that already looks intentional, then a slug
 * split into words. Slug-only input ("andurilindustries") cannot be split
 * reliably, so it at least gets a capital letter rather than staying lowercase.
 */
export function displayCompany(name) {
    const text = (name ?? "").trim();
    if (!text)
        return "";
    const compact = text.toLowerCase().replace(/[\s_-]+/g, "");
    const brand = BRAND_NAMES[compact];
    if (brand)
        return brand;
    // Already has deliberate capitalisation ("Cohere", "OpenAI for Gov").
    if (text !== text.toLowerCase())
        return text;
    // Slug with separators: split and capitalise each word.
    if (/[\s_-]/.test(text)) {
        return text
            .split(/[\s_-]+/)
            .filter(Boolean)
            .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
            .join(" ");
    }
    return text.slice(0, 1).toUpperCase() + text.slice(1);
}
/** True when we saw fewer roles than the board claims to have. */
export function isPartial(signal) {
    return signal.board_reported_roles > signal.open_roles;
}
/** One-line human-readable read of the signal. */
export function verdict(signal) {
    const { company } = signal;
    if (signal.unknown) {
        // Two very different causes: a real enterprise on a bespoke career site, or
        // a name that does not exist. Say both, don't guess.
        return (`${company}: no job board found. Most likely a large company with its own ` +
            `careers site, or the name didn't match. Check the spelling, or search for ` +
            `its careers page.`);
    }
    if (signal.open_roles === 0) {
        return `${company}: board is live but currently has no open roles.`;
    }
    const top = signal.top_departments
        .slice(0, 3)
        .map((d) => `${friendlyDepartment(d.department)} - ${d.open_roles}`)
        .join(", ");
    const recency = signal.hiring_recently
        ? `${signal.recent_roles} posted in the last ${signal.recent_days} days`
        : "nothing posted recently";
    const plural = signal.open_roles === 1 ? "" : "s";
    // "at least N" reads as competent handling of an API page limit; "partial"
    // made it look like something broke.
    const count = isPartial(signal)
        ? `at least ${signal.open_roles} open role${plural} (${signal.board_reported_roles} total; ${signal.open_roles} read)`
        : `${signal.open_roles} open role${plural}`;
    return `${company}: ${count} -- ${recency}. Top areas: ${top || "n/a"}.`;
}
export function signalToDict(signal) {
    return {
        company: signal.company,
        open_roles: signal.open_roles,
        board_count: signal.board_count,
        recent_roles: signal.recent_roles,
        recent_days: signal.recent_days,
        hiring_recently: signal.hiring_recently,
        top_departments: signal.top_departments.map((d) => ({
            department: d.department,
            open_roles: d.open_roles,
        })),
        boards: signal.boards.map((b) => ({ ...b })),
        unknown: signal.unknown,
        partial: isPartial(signal),
        board_reported_roles: signal.board_reported_roles,
        verdict: verdict(signal),
    };
}
/**
 * Build a HiringSignal from an already-fetched board snapshot.
 *
 * Department is the proxy for "what are they investing in". Postings without a
 * department are grouped under "unspecified" rather than dropped, so the totals
 * always reconcile with `open_roles`.
 */
export function summarizeHiring(company, boards, jobs, options = {}) {
    const recentDays = options.recentDays ?? 30;
    const now = options.now ?? new Date();
    const liveBoards = boards.filter((b) => b.job_count > 0);
    const signal = {
        company,
        boards: liveBoards,
        board_count: liveBoards.length,
        open_roles: jobs.length,
        top_departments: [],
        hiring_recently: false,
        recent_roles: 0,
        // "Unknown" means no usable board at all. A live board that is simply empty
        // is a real, reportable answer (0 open roles), not unknown.
        unknown: liveBoards.length === 0,
        recent_days: recentDays,
        board_reported_roles: liveBoards.reduce((sum, b) => sum + b.job_count, 0),
    };
    if (signal.unknown)
        return signal;
    const counts = new Map();
    for (const job of jobs) {
        const dept = (job.department ?? "").trim() || "unspecified";
        counts.set(dept, (counts.get(dept) ?? 0) + 1);
    }
    signal.top_departments = [...counts.entries()]
        .map(([department, open_roles]) => ({ department, open_roles }))
        .sort((a, b) => b.open_roles - a.open_roles || a.department.localeCompare(b.department));
    for (const job of jobs) {
        const posted = parseIso(job.posted_at);
        if (posted && daysSince(posted, now) <= recentDays)
            signal.recent_roles++;
    }
    signal.hiring_recently = signal.recent_roles > 0;
    return signal;
}
