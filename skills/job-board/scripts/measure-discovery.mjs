#!/usr/bin/env node
/**
 * Measure discovery: for a fixed, pre-registered list of company names, does the same
 * function the CLI uses (discoverBoards) return at least one live board?
 *
 * Run from the skill directory, after `npm run build`:
 *   node scripts/measure-discovery.mjs > discovery.json
 *
 * The list is fixed here, before any run, so it cannot be tuned to the results. Changing
 * it means a new measurement with a new date. Transient lookup failures are recorded per
 * company; a company with transient failures may be a false negative and should be re-run.
 */
import { discoverBoards } from "../dist/discovery.js";

export const SAMPLE = [
  "Stripe", "Ramp", "Notion", "Figma", "Databricks", "Anthropic", "OpenAI",
  "Airbnb", "Dropbox", "Asana", "Canva", "Lyft", "Coinbase", "Brex", "Plaid",
  "Rippling", "Gusto", "Vercel", "Linear", "Miro", "Monday.com", "Wiz",
  "Snowflake", "Datadog", "Cloudflare", "Twilio",
];

/** Wilson score interval, 95%. */
export function wilson(k, n, z = 1.959964) {
  if (n === 0) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const rows = [];
for (const company of SAMPLE) {
  const errors = [];
  const started = Date.now();
  const boards = await discoverBoards(company, { errors });
  rows.push({
    company,
    resolved: boards.length > 0,
    boards: boards.map((b) => ({ ats: b.ats, slug: b.slug, job_count: b.job_count })),
    transient_errors: errors.length,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  });
  process.stderr.write(`${company}: ${boards.length > 0 ? "resolved" : "no board"}\n`);
}

const n = rows.length;
const k = rows.filter((r) => r.resolved).length;
const [lo, hi] = wilson(k, n);
const byAts = {};
for (const r of rows) for (const b of r.boards) byAts[b.ats] = (byAts[b.ats] ?? 0) + 1;
console.log(
  JSON.stringify(
    {
      sample_size: n,
      resolved: k,
      rate: Math.round((k / n) * 1000) / 1000,
      wilson95: [Math.round(lo * 1000) / 1000, Math.round(hi * 1000) / 1000],
      companies_by_ats: byAts,
      companies_with_transient_errors: rows.filter((r) => r.transient_errors > 0).map((r) => r.company),
      rows,
    },
    null,
    2,
  ),
);
