---
name: laid-off
description: After a layoff, find open roles or check if a named company is still hiring, by reading its ATS job board directly (Greenhouse, Lever, Ashby, SmartRecruiters). Needs company names; not for discovery.
license: MIT
compatibility: Node.js 20+ (no runtime dependencies). Optional LAID_OFF_SEARCH_API_KEY for search-engine fallback.
metadata:
  version: "2.0.0"
  upstream-idea: "site:<ats-domain> boolean job search"
---

# Laid-off

Find live job postings on **company ATS boards** instead of job aggregators.

Most jobs are never posted to LinkedIn. But almost every company that uses a
modern ATS (Greenhouse, Lever, Ashby, SmartRecruiters) publishes its full board
as **structured JSON** at a predictable URL. This skill queries those APIs
directly — no scraping, no search engine required, no LinkedIn.

## Read this first: what this can and cannot do

**Requires company names.** This is a job *inspector*, not a job *finder*. It
cannot answer "who is hiring for my role?" — it only looks inside companies you
name. If the user has no companies in mind, see *When the user has no companies*
below before running anything.

| Works well | Does not work |
|---|---|
| "Which roles is Stripe hiring for?" | "Find me any company hiring engineers" |
| "Is Notion still hiring after layoffs?" | Companies on iCIMS, Workday, Workable, or a custom site |
| "PM roles at Ramp, Figma, Linear" | Anything, if the company name is wrong |

Large enterprises (Amazon, Google, Meta, Microsoft) have no supported board, but
they **do** work when `LAID_OFF_SEARCH_API_KEY` is set: the search fallback returns real
postings from ATS-hosted boards at those companies' peers. Without a key you get
a ready-made query to run yourself, not an empty result.

Tell the user which case they are in **before** they invest effort, and offer the
fallbacks in *Known limitations* rather than running a search that returns nothing.

## Why this beats searching LinkedIn

- **Less contested**: ATS listings are the source of truth; aggregators repost
  them later, after the first wave of applicants.
- **Structured**: real locations, departments, compensation, post dates.
- **Complete**: you see *every* open role at a company, not a ranked subset.
- **Layoff-aware**: `--check` reads a company's live board, so after a layoff
  announcement you can see whether it is *still hiring* and in which areas.

## Quick start

Run `node dist/main.js` from this skill directory. The entry point resolves
paths from its own location, so it works from any cwd, and it needs **no
`npm install`** — the shipped JavaScript has zero runtime dependencies.

```bash
# 1. Roles at companies you name
node dist/main.js --company Stripe --company Ramp --title "software engineer"

# 2. Is this company still hiring after its layoff announcement, and for what?
node dist/main.js --check Stripe --check Notion --format md

# 3. See which ATS boards a company actually has
node dist/main.js --company Notion --list-boards

# 4. Generate boolean site: queries (no API key needed)
node dist/main.js --company Stripe --title "chief of staff" --queries
```

Output defaults to JSON. Formats: `json` (default), `json-compact`, `md`
(concise), `detail` (one block per role, with emoji) and `html` (standalone
page). See *Reading the results* for the JSON shape.

**Emoji appear only in `detail` and `html`.** `json`, `json-compact` and `md`
stay plain — an agent parses JSON, and `md` is the compact scanning format.

## How it works

```
  user inputs                       discovery                 fetching
  ───────────                       ─────────                 ────────
  --company Acme ─────────────────► slug candidates ──► probe each ATS ──► live boards
                                                              │
  --title/--location ────────────────────────────────────┐    ▼
  --remote/--keyword                                     └──► fetch postings (JSON API)
                                                              │
                                                              ▼
                                              filter ──► dedupe ──► rank ──► JSON / Markdown

  --check Acme ──────────────► same discover+fetch ──► hiring signal
                                                       (open roles, recency,
                                                        top departments)
```

1. **Seed** — explicit `--company` names (there is no filing-feed seeding; see
   *Why not seed from layoff filings* below).
2. **Discover** — derive slug candidates (`"Cisco Systems, Inc."` → `ciscosystems`,
   `cisco`, `cisco-systems`) and probe each ATS. Boards are **identity-verified**:
   a board is accepted only if its company name covers the queried company, which
   rejects look-alikes such as `general motors` → a board named "General Interest".
3. **Fetch** — pull every posting from each live board in parallel.
4. **Filter** — apply title (with synonym expansion), location, remote,
   seniority, keyword and exclusion rules.
5. **Rank** — title/keyword relevance first, freshness as the tie-breaker.

## When the user has no companies

Do not run a search. Ask one question, offering the three viable routes:

1. **"Which companies do you want to work at?"** — the strongest path. Even two
   or three names produces useful results.
2. **"Give me a role and I'll write searches you can run yourself"** — run
   `--queries` (no API key, no network) and hand over the boolean `site:` URLs.
3. **"Which companies just laid people off?"** — a layoff feed is a decent *name
   generator* (`references/layoff-data.md` has the one-liner), but most large
   filers are enterprises this skill cannot read. Say so up front.

Be explicit that open-ended discovery is out of scope for this skill. Do not
improvise a company list and present it as comprehensive.

## Asking the user for inputs

Before running, establish the user's search profile. Ask concisely, and only for
what they have not already said:

| Input | Flag | Example |
|---|---|---|
| Target titles | `--title` (repeatable) | `"chief of staff"`, `"staff engineer"` |
| Locations | `--location` (repeatable) | `"New York"`, `"Berlin"` |
| Remote only | `--remote` | — |
| Seniority | `--seniority` | `intern`, `junior`, `mid`, `senior`, `director` |
| Must-have keywords | `--keyword` (repeatable, AND) | `python`, `kubernetes` |
| Deal-breakers | `--exclude-keyword` | `contract`, `on-call` |
| Companies to skip | `--exclude-company` | `Meta` |
| Freshness | `--max-age-days` | `14` |
| Is it still hiring? | `--check` (repeatable) | `--check Stripe` |
| "Recently" window | `--recent-days` | `30` |
| Cap companies probed | `--max-companies` | `40` |
| Reuse ATS responses | `--cache-ttl` (seconds, `0` = off) | `300` |
| Clear the cache | `--clear-cache` | — |

If the user is vague ("find me a job"), propose a starting profile from their
background and confirm it before running a broad search.

## Reading the results

Output defaults to JSON, with **two different top-level shapes** depending on
mode. Parse `jobs` for `--company`, and `signals` for `--check`.

**`--company` (role search):**

```json
{
  "generated_at": "2026-11-09T...",
  "count": 37,
  "meta": {"companies searched": 1, "live boards": 1, "raw postings": 767,
           "matched postings": 37, "returned": 37, "queries offered": 8},
  "warnings": ["..."],
  "empty_reason": null,
  "boards": [{"company": "Cohere", "ats": "ashby", "slug": "cohere", "job_count": 124, "url": ""}],
  "queries": ["site:... \"title\" ..."],
  "jobs": [{"title": "...", "company": "...", "url": "...", "source": "ashby",
            "location": "...", "remote": true, "department": "...",
            "employment_type": "FullTime", "posted_at": "ISO-8601",
            "compensation": "CA$340K – CA$450K • Offers Equity",
            "identifier": "...", "snippet": ""}]
}
```

**`--check` (hiring report):**

```json
{
  "generated_at": "...", "count": 1, "warnings": [], "queries": [],
  "signals": [{"company": "Cohere", "open_roles": 124, "board_count": 1,
               "recent_roles": 40, "recent_days": 30, "hiring_recently": true,
               "top_departments": [{"department": "Engineering & Infra", "open_roles": 12}],
               "boards": [...], "unknown": false, "partial": false,
               "board_reported_roles": 124, "verdict": "one-line summary"}]
}
```

`count` is how many jobs are in this payload; `total` is how many matched before
`--limit`. Check `truncated` before saying "there are N roles".

`empty_reason` is `null` unless the result is empty, and then names the cause so
you can give the right advice instead of "try widening the filters":

| `kind` | Meaning | What to tell the user |
|---|---|---|
| `no_key` | No readable board, and the search fallback has no API key | Set `LAID_OFF_SEARCH_API_KEY` and re-run |
| `no_board` | No supported ATS board exists for the named companies | Try a smaller company, or set the key |
| `filtered` | The board had roles; every one was filtered out | Widen `--title`/`--location`, drop `--remote` |

Never answer a `no_key` or `no_board` result with "no matching roles" — the
roles were never read.

Always parse `warnings` — a thin result is explained there. Exit codes: `0` on
success, `2` on a usage error (no target, or `--queries` without `--title`).

`--format json-compact` drops the `identifier` field (already inside `url`) and
empty fields. Use it when feeding many results into context; measured ~11%
fewer characters on dense Cohere data, more when many roles lack departments.

Diagnose a zero result from `meta`:

```json
"meta": {
  "companies searched": 1,
  "live boards": 1,
  "raw postings": 100,      // postings found on live boards
  "matched postings": 0,    // postings that passed the profile
  "returned": 0,            // postings after dedupe + rank
  "queries offered": 8
}
```

- `raw postings: 0`, `live boards: 0` → the company has no supported ATS board
  (common for enterprises; see below). Use the offered `site:` queries.
- `raw postings > 0`, `matched postings: 0` → the boards had jobs, but the
  profile excluded them all. Widen `--title`/`--location` or drop filters.
- `partial: true` (in `--check`) → the board reports more roles than were read;
  never quote `open_roles` as a total.
- `unknown: true` (in `--check`) → no board found; do not report "not hiring".

## Known limitations

- **Enterprises use bespoke career sites.** Amazon, Microsoft, Meta, Intel,
  Walmart and Google resolve on **none** of the supported ATSes, so direct board
  reading returns nothing. With `LAID_OFF_SEARCH_API_KEY` set the search fallback fills
  the gap (verified: Amazon → 33 Chief-of-Staff roles from ATS boards). Without
  a key, hand the user the generated `site:` query.
- **BambooHR is supported but per-tenant.** `<company>.bamboohr.com/careers/list`
  returns JSON, so it works by slug probing only — never via `site:`.
- **iCIMS and Workday are per-tenant.** They live at
  `careers-<company>.icims.com` and `<company>.wd1.myworkdayjobs.com`, so a
  `site:` query on the bare domain returns almost nothing. They are deliberately
  excluded from the generated query list.
- **`--check` cannot read enterprises.** A large employer with a bespoke career
  site returns `unknown: true` and a discovery query, not `0 open roles`. Never
  report "not hiring" from an unknown signal.
- **Boards paginate.** SmartRecruiters is fetched one 100-job page; its
  `job_count` reports the true `totalFound`. `--check` flags this as
  `partial: true` and says "partial: board reports N" rather than understating.
- **Seniority is title-only.** Ramp, for example, puts no seniority in its
  titles (all 29 engineer roles are unmarked), so `--seniority senior` correctly
  returns nothing. An empty seniority result means the board does not encode it,
  not that no senior roles exist.
- **Departments are vendor-specific.** Greenhouse's `/jobs` omits departments,
  so they are resolved from its `/departments` tree and rolled up to the top
  level (Stripe: GTM/Tech/Core). SmartRecruiters often leaves `department` empty
  and only fills `function`, which is used instead. Anything still unlabeled is
  reported as "unspecified" rather than dropped.

## Why not seed from layoff filings

An earlier version seeded searches straight from WARN Act filings (via
`kadoa-org/layoffs-tracker`, 30,430 companies). It was removed after measurement:

1. **WARN cannot express "tech"** — the fields are company/workers/states/dates,
   with no industry or occupation. Seeding returned Boeing, Walmart, Sodexo,
   Tyson Foods and a school-bus operator, not tech companies.
2. **The seed and the searchable pool are anti-correlated** — the largest filers
   (Amazon, Meta, Google, Intel, Microsoft) resolve on none of the supported
   ATSes, so the most interesting companies were the least searchable.
3. **Low yield** — 8 of 60 recent filers resolved to any board, several of them
   look-alikes later rejected by identity verification.

`--check` replaces it with the useful inversion: start from a company the user
cares about and ask *is it still hiring, and for what?*

## Search-engine fallback (optional)

The `site:` query generator works with no key. To *execute* queries, set a key:

Both halves of the search configuration share a `LAID_OFF_` prefix, so
remembering one gives the other:

```bash
export LAID_OFF_SEARCH_API_KEY=...      # the key
export LAID_OFF_SEARCH_PROVIDER=kagi    # kagi (default) or brave
```

Key URLs: Kagi https://kagi.com/settings/api · Brave
https://api.search.brave.com/

An unknown provider is a hard error (exit 2), not a silent fallback — searching
with the wrong engine would bill the wrong account. The same applies if both the
current and former variable names are set to *different* values.

Tuning, all under the same prefix:

```bash
export LAID_OFF_HTTP_TIMEOUT=20         # seconds, must be positive
export LAID_OFF_CACHE_TTL=300           # seconds to reuse ATS responses; 0 = off
export LAID_OFF_CACHE_DIR=~/.cache/jobsearch
```

The former names (`SEARCH_API_KEY`, `JOBSEARCH_SEARCH_PROVIDER`,
`JOBSEARCH_HTTP_TIMEOUT`, `JOBSEARCH_CACHE_TTL`, `JOBSEARCH_CACHE_DIR`) still
work but each prints a deprecation warning; they will be removed in a future
release. An invalid value is a hard error (exit 2) rather than a silent default.

See `references/providers.md` for the exact API contracts.

## Reference files

- `references/ats-endpoints.md` — verified endpoints and payload shapes.
- `references/providers.md` — Kagi/Brave API contracts and error codes.
- `references/layoff-data.md` — WARN dataset schema and caveats.
