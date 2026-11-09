/**
 * Minimal HTML helpers.
 *
 * Node has no HTML entity decoder (`decodeURIComponent` only handles URL
 * escapes), so the port needs its own. Python's `html.unescape` handles ~2,000
 * named entities; only a small subset realistically appears in job titles,
 * snippets and slugs, and this covers those plus numeric references.
 */
/** Named entities that plausibly appear in ATS text. */
const NAMED = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
    ndash: "\u2013",
    mdash: "\u2014",
    hellip: "\u2026",
    lsquo: "\u2018",
    rsquo: "\u2019",
    ldquo: "\u201c",
    rdquo: "\u201d",
    bull: "\u2022",
    middot: "\u00b7",
    copy: "\u00a9",
    reg: "\u00ae",
    trade: "\u2122",
    deg: "\u00b0",
    plusmn: "\u00b1",
    times: "\u00d7",
    divide: "\u00f7",
    eacute: "\u00e9",
    egrave: "\u00e8",
    agrave: "\u00e0",
    ccedil: "\u00e7",
    uuml: "\u00fc",
    ouml: "\u00f6",
    auml: "\u00e4",
    szlig: "\u00df",
    ntilde: "\u00f1",
    euro: "\u20ac",
    pound: "\u00a3",
    yen: "\u00a5",
    cent: "\u00a2",
};
const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;
/** Decode HTML entities and numeric character references. */
export function unescapeHtml(text) {
    return text.replace(ENTITY, (whole, body) => {
        if (body.startsWith("#x") || body.startsWith("#X")) {
            const code = Number.parseInt(body.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        if (body.startsWith("#")) {
            const code = Number.parseInt(body.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return NAMED[body.toLowerCase()] ?? whole;
    });
}
const TAG = /<[^>]*>/g;
/** Remove markup from a text fragment (e.g. a highlighted search snippet). */
export function stripHtml(text) {
    return unescapeHtml(text.replace(TAG, "")).trim();
}
