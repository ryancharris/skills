# job-search

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

Requires Python 3.10+ (standard library only).

This skill lives in a multi-skill repo at `skills/job-search/`. Either

```bash
# symlink so the harness picks it up and the repo stays the source of truth
ln -s "$PWD/skills/job-search" ~/.agents/skills/job-search

# or copy just this skill
git clone <this-repo> /tmp/skills && cp -r /tmp/skills/skills/job-search ~/.agents/skills/
```

pi and Claude Code discover `~/.agents/skills/` and `~/.claude/skills/`
recursively. Or run `./jobsearch.py` straight from the directory — the entry point
is self-locating and needs no install or `PYTHONPATH`.

## Use

```bash
# Roles at companies you name
./jobsearch.py --company Stripe --company Ramp --title "software engineer"

# Is this company still hiring after its layoff, and for what?
./jobsearch.py --check Stripe --check Notion --format md

# Which ATS boards does a company have?
./jobsearch.py --company Notion --list-boards

# Generate boolean site: queries (no API key needed)
./jobsearch.py --company Stripe --title "chief of staff" --queries

# Markdown report for humans
./jobsearch.py --company Stripe --title engineer --format md --limit 20
```

### Flags

| Flag | Description |
|---|---|
| `--company` | Company name (repeatable) |
| `--check` | Report whether each company is hiring, and for what (repeatable) |
| `--recent-days` | Window for the `--check` "hiring recently" test (default 30) |
| `--max-companies` | Cap companies probed (default 40) |
| `--title` | Job title; expands to synonyms (repeatable) |
| `--location` | Location filter (repeatable) |
| `--remote` | Remote roles only |
| `--seniority` | `intern`/`junior`/`mid`/`senior`/`director` |
| `--keyword` | Required keyword, AND-ed (repeatable) |
| `--exclude-keyword` | Excluded keyword |
| `--exclude-company` | Excluded company |
| `--max-age-days` | Only postings newer than N days |
| `--format` | `json` (default) or `md` |
| `--limit` | Max results (default 50) |
| `--queries` | Print generated `site:` queries only |
| `--list-boards` | Print resolved boards only |
| `--cache-ttl` | Reuse ATS responses for N seconds (default `0` = off) |
| `--clear-cache` | Delete cached responses, then exit |

## Configuration

```bash
export SEARCH_API_KEY=...               # only needed for the search fallback
export JOBSEARCH_SEARCH_PROVIDER=kagi   # or: brave
export JOBSEARCH_HTTP_TIMEOUT=20

# Optional response cache. Off by default: stale job data is a correctness
# risk, so opt in with a short TTL when you are running repeated searches.
export JOBSEARCH_CACHE_TTL=300          # seconds; 0 disables
export JOBSEARCH_CACHE_DIR=~/.cache/jobsearch
```

Caching is read-through and fails safe: any cache error falls back to a normal
request. Only GETs are cached — the search API is billed per call and is never
replayed.

## Supported ATS

Greenhouse, Lever, Ashby, SmartRecruiters, BambooHR. See
[`references/ats-endpoints.md`](references/ats-endpoints.md).

BambooHR is per-tenant (`<company>.bamboohr.com`) — a `site:` query on its bare
domain returns nothing, so it is reachable only by slug probing. Same for iCIMS
and Workday, which remain unsupported. Workable is not supported either: its
careers pages are JS-rendered and its widget API returns an empty `jobs` list
for every account tested, with no public jobs endpoint.

## Known limitations

- **Enterprises** (Amazon, Microsoft, Meta, Intel, Walmart, Google) use bespoke
  career sites and resolve on none of the supported ATSes.
- **`--check` cannot read enterprises** for the same reason; it returns
  `unknown: true` plus a discovery query rather than implying "not hiring".
- **Boards paginate**: SmartRecruiters returns 100 per page while `job_count`
  reports the true total.
- Measured discovery rate on 26 modern tech companies: **85%**.

## Tests

From `skills/job-search/`, using the repo-root dev venv:

```bash
../.venv/bin/python -m pytest                    # unit + mocked (fast)
JOBSEARCH_LIVE_TESTS=1 ../.venv/bin/python -m pytest   # + live network
```

The live suite exists because the vendor quirks that actually broke this skill
(identity collisions, Ashby's 403 without a User-Agent, SmartRecruiters' 200 on
missing slugs) are invisible to mocks.

## Layout

In this repo: `skills/job-search/`. Everything below is relative to that
directory, which is also the skill root a harness loads.

```
SKILL.md              # agent-facing instructions (required by the spec)
jobsearch.py          # self-locating entrypoint
jobsearch/            # importable package
  ats/                # ATS adapters + identity verification
  search/             # pluggable search providers (Kagi, Brave)
  discovery.py        # company -> live boards
  hiring_signal.py    # "is it still hiring?" + why the WARN feed was dropped
  filtering.py        # profile expansion + filtering + ranking
  pipeline.py         # orchestration
  output.py           # dedupe + JSON/Markdown
  cli.py              # command line
references/           # verified API contracts and caveats
tests/                # unit, mocked, live
```


