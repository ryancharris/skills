# laid-off

Find live job postings by querying company **ATS boards** directly, and check
whether a company is **still hiring** after a layoff.

Most jobs are never posted on LinkedIn. Almost every company on a modern ATS
publishes its full board as structured JSON; this skill queries those APIs
instead of scraping aggregators.

```
  --company Acme ──► discover ATS boards ─► fetch postings ─► filter ─► rank ─► JSON/Markdown
  --title/--remote ─────────────────────────────────────────────┘

  --check Acme ─────► same discover+fetch ─► hiring signal (open roles, recency, departments)
```

## Install

Requires **Node.js 20+**. No runtime dependencies: build once, then the
compiled JavaScript runs anywhere Node does.

This skill lives in a multi-skill repo at `skills/laid-off/`. Either

```bash
# symlink so the harness picks it up and the repo stays the source of truth
ln -s "$PWD/skills/laid-off" ~/.agents/skills/laid-off

# or copy just this skill
git clone <this-repo> /tmp/skills && cp -r /tmp/skills/skills/laid-off ~/.agents/skills/
```

pi and Claude Code discover `~/.agents/skills/` and `~/.claude/skills/`
recursively. Or run `node dist/main.js` from inside the skill directory. From anywhere else,
use the absolute path (`node /path/to/laid-off/dist/main.js ...`). No install or
`PYTHONPATH` is needed.

## Use

The examples below assume you are in the skill directory (`cd laid-off`). For
an agent harness, see the path rule in `SKILL.md`.

```bash
# Roles at companies you name
node dist/main.js --company Stripe --company Ramp --title "software engineer"

# Is this company still hiring after its layoff, and for what?
node dist/main.js --check Stripe --check Notion --format md

# Which ATS boards does a company have?
node dist/main.js --company Notion --list-boards

# Generate boolean site: queries (no API key needed)
node dist/main.js --company Stripe --title "chief of staff" --queries

# Markdown report for humans
node dist/main.js --company Stripe --title engineer --format md --limit 20
```

### Flags

Run `node dist/main.js --help` for the authoritative list — it is generated from the
code, so it cannot drift. The ones you will reach for first:

| Flag | Description |
|---|---|
| `--company` | Company name (repeatable) — role search |
| `--check` | Report whether a company is hiring (repeatable) |
| `--title` | Job title; expands to synonyms (repeatable) |
| `--remote` | Remote roles only |
| `--format` | See *Output formats* below |
| `--limit` | Max results to print (default 50) |

Filtering also takes `--location`, `--seniority`, `--keyword`,
`--exclude-keyword`, `--exclude-company` and `--max-age-days`. For the full
reference, including `--queries`, `--list-boards` and the cache flags, see
[`SKILL.md`](SKILL.md), which is the agent-facing source of truth.

## Configuration

```bash
# Every user-facing setting shares a LAID_OFF_ prefix. The key is only needed
# for the search fallback; a company with a readable ATS board works without one.
export LAID_OFF_SEARCH_API_KEY=...
export LAID_OFF_SEARCH_PROVIDER=kagi     # kagi (default) or brave

export LAID_OFF_HTTP_TIMEOUT=20

# Optional response cache. Off by default: stale job data is a correctness
# risk, so opt in with a short TTL when you are running repeated searches.
export LAID_OFF_CACHE_TTL=300           # seconds; 0 disables
export LAID_OFF_CACHE_DIR=~/.cache/jobsearch
```

Caching is read-through and fails safe: any cache error falls back to a normal
request. Only GETs are cached — the search API is billed per call and is never
replayed.
JSON output reports `cached` and `fetched_at`, so a cached result is not presented as
fresh.

## Supported ATS

Greenhouse, Lever, Ashby, SmartRecruiters, BambooHR. See
[`references/ats-endpoints.md`](references/ats-endpoints.md).

BambooHR is per-tenant (`<company>.bamboohr.com`) — a `site:` query on its bare
domain returns nothing, so it is reachable only by slug probing. Same for iCIMS
and Workday, which remain unsupported. Workable is not supported either: its
careers pages are JS-rendered and its widget API returns an empty `jobs` list
for every account tested, with no public jobs endpoint.

## Output formats

| Format | For | What you get |
|---|---|---|
| `json` | agents | full structured result (default) |
| `json-compact` | agents | same, with empty fields dropped |
| `md` | humans | one line per role, with badges, easy to scan 50 results |
| `detail` | humans | one block per role, with emoji and a copyable link |
| `html` | humans | standalone page to send to someone |

`md`, `detail` and `html` also state partial reads, cached data and warnings in plain
text, so the person reading sees what an agent is told.

Emoji appear in `md`, `detail` and `html`. `json` and `json-compact` stay plain: an
agent parses them.

```bash
node dist/main.js --company OpenAI --remote --title "infrastructure security" --format detail
node dist/main.js --company Cohere --title platform --format html > jobs.html
```

`html` output is self-contained: no scripts, no external assets, works offline.

## Known limitations

- **Enterprises** (Amazon, Microsoft, Meta, Intel, Walmart, Google) use bespoke
  career sites and resolve on none of the supported ATSes.
- **`--check` cannot read enterprises** for the same reason; it returns
  `unknown: true` plus a discovery query rather than implying "not hiring".
- **Boards paginate**: SmartRecruiters returns 100 per page and the read stops at
  1,000 postings. A larger board is reported as `partial` in both role search and
  `--check`, with its true total, so the count is never silently understated.
- Measured discovery rate on 26 modern tech companies: **85%**.

## Tests

From `skills/laid-off/`, after `npm install`:

```bash
npm test                    # unit, format, cache and end-to-end tests; NO network
npm run test:live           # real ATS APIs, opt-in
```

The end-to-end tests (`tests-ts/e2e.test.ts`) run the built `dist/main.js` against a
synthetic board served by a preload module, so they exercise the shipped build with
no network and no API keys.

**`npm test` can never make a live API call.** That is enforced, not assumed:

1. Live tests live under `tests-ts/live/` and are excluded unless
   `JOBSEARCH_LIVE_TESTS=1`.
2. `tests-ts/setup.ts` replaces `fetch` for every test run. Any request throws a
   `NetworkGuardError` naming the host and telling the author what to do instead.
   It fails in ~2 ms rather than paying retry backoff.
3. A small allow-list of ATS and search hosts — and a denylist for LinkedIn,
   Indeed and Glassdoor, which must never be contacted even in live mode.
4. `tests-ts/network-guard.test.ts` tests the guard itself, so it cannot rot.

The live suite still exists because the vendor quirks that actually broke this
skill (identity collisions, Ashby's 403 without a User-Agent, SmartRecruiters'
200 on missing slugs) are invisible to mocks. It is for deliberate, manual runs —
never CI.

## Layout

In this repo: `skills/laid-off/`. Everything below is relative to that
directory, which is also the skill root a harness loads.

```
SKILL.md              # agent-facing instructions (required by the spec)
src/                  # TypeScript source
  main.ts             # self-locating entrypoint
  cli.ts              # argument parsing + exit codes
  pipeline.ts         # orchestration: discover -> fetch -> filter -> rank
  ats.ts              # ATS adapters + identity verification
  discovery.ts        # company -> live boards
  filtering.ts        # profile expansion + filtering + ranking
  hiring-signal.ts    # "is it still hiring?" + why the WARN feed was dropped
  search.ts           # pluggable search providers (Kagi, Brave)
  output.ts           # dedupe + JSON/Markdown
  http.ts / cache.ts  # fetch + retries, optional TTL cache
  html.ts             # entity decoding (Node has no built-in decoder)
dist/                 # compiled JavaScript -- this is what runs
tests-ts/             # unit, mocked, live, and parity vs the old Python build
references/           # verified API contracts and caveats
```

## Developing

```bash
npm install          # dev-only: typescript + vitest
npm run build        # src/ -> dist/
npm test             # 140 offline tests
npm run test:live    # + live network (163 total)
```

`dist/` is what consumers run; `node_modules` is never needed at runtime.



