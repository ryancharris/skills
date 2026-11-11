# job-board

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

This skill is the `skills/job-board/` folder of this repo. Run these from the repo root:

```bash
# symlink so the harness picks it up and the repo stays the source of truth
ln -s "$PWD/skills/job-board" ~/.agents/skills/job-board

# or copy just this skill
cp -r skills/job-board ~/.agents/skills/
# If you ran `npm install` in the repo, the copy includes its node_modules (dev tools,
# about 50 MB). Copy from a fresh clone, or delete node_modules from the copy.
```

pi and opencode discover `~/.agents/skills/` (both verified by listing the skill
in each). Claude Code reads `~/.claude/skills/` (its skills docs say so; not tested on this
machine). Or run `node dist/main.js` from inside the skill directory. From anywhere else,
use the absolute path (`node /path/to/skills/job-board/dist/main.js ...`). No install or
`PYTHONPATH` is needed.

### Claude Code plugin

This repo is a Claude Code plugin marketplace. Tested with Claude Code 2.1.308:

```bash
claude plugin marketplace add ryancharris/skills
claude plugin install job-board@ryancharris-skills
```

### pi package

This repo is also a pi package. The skill is declared in the root `package.json`:

```bash
pi install git:github.com/ryancharris/skills
pi list                 # confirm; pi remove git:github.com/ryancharris/skills to undo
```

Both routes need the repo to be public, or GitHub access to it. If the skill is also
symlinked into `~/.agents/skills/`, pi loads that copy in preference to the package
copy. Keep one of the two.

## Use

The examples below assume you are in the skill directory (`cd skills/job-board`). For
an agent harness, see the path rule in `SKILL.md`.

```bash
# Roles at companies you name (JSON by default, for agents; add --format md for a readable report)
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
# Every user-facing setting shares the JOB_BOARD_ prefix. The key is only needed
# for the search fallback; a company with a readable ATS board works without one.
export JOB_BOARD_SEARCH_API_KEY=...
export JOB_BOARD_SEARCH_PROVIDER=kagi     # the example; or brave, or exa (table below)

export JOB_BOARD_HTTP_TIMEOUT=20

# Optional response cache. Off by default: stale job data is a correctness
# risk, so opt in with a short TTL when you are running repeated searches.
export JOB_BOARD_CACHE_TTL=300           # seconds; 0 disables
export JOB_BOARD_CACHE_DIR=~/.cache/job-board
```

### Search providers

The search fallback (used for companies with no readable board) needs one key,
`JOB_BOARD_SEARCH_API_KEY`, and a provider. Kagi is the example above. The same key
works with any provider you choose with `JOB_BOARD_SEARCH_PROVIDER`.

| Provider | `JOB_BOARD_SEARCH_PROVIDER` | Get a key | What has been verified |
|---|---|---|---|
| Kagi (the example, default) | `kagi` | https://kagi.com/settings/api | A search with a real key ran in an earlier round (Amazon: 33 roles from ATS boards) |
| Brave | `brave` | https://api.search.brave.com/ | Endpoint, header and response shape against Brave's documentation, and tests. A bad key is rejected (HTTP 422). A search with a real key has not been run. |
| Exa | `exa` | https://dashboard.exa.ai/api-keys | One real search ran with a key (the live test, one query; it returned usable results). Also checked: Exa's documented endpoint and header, and a bad key is rejected (HTTP 401). Without a key Exa answers HTTP 402 (payment), so a key is required. |

An unknown provider name is an error (exit 2), not a silent fallback.

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
- Measured discovery rate: **23 of 26 (88.5%; 95% interval 71–96%)** on a fixed sample of
  26 tech company names, run with `scripts/measure-discovery.mjs` (round 21). The three
  misses (Rippling, Monday.com, Wiz) have no board under the slugs the skill tries.
- **Agents can still add hiring context from memory.** For a company the skill
  cannot read (Amazon, no key), agents sometimes write "yes, still hiring" or
  "large companies typically keep hiring". Measured on the neutral prompt "I was just
  laid off from Amazon. Is Amazon still hiring?", 16 runs per harness:
  - pi, without a rule: 6 of 16 runs made such a claim. With the rule below: **0 of 16**.
  - opencode, without a rule: 8 of 16. With the rule below: 7 of 16, and with a
    stronger wording 8 of 16. No rule changed opencode's behaviour.
  - **What changed it:** the skill's "cannot read this company" line now gives the
    exact sentence to quote, instead of guessing why the board is missing. On
    opencode, runs with an unsupported hiring claim fell from 8 of 16 to 5 of 48
    (three batches; the middle batch was 4 of 16). Web searches fell from 4 of 16 to
    1 of 48. pi was unchanged (6 of 16), so pi still needs the rule above.
  - **What did not reduce it further:** adding "with nothing added" to the quoted
    sentence (4 of 32), and adding the AGENTS rule on top of the quoted sentence
    (5 of 16). The residual on opencode is about 10%, and no variant tested has
    reached zero.

  If you want the pi behaviour, add this to your own `AGENTS.md`:

  ```markdown
  # Hiring claims

  Do not state whether a company is hiring, and do not describe hiring trends, unless a
  tool you ran in this session returned that data. If a tool could not read the company,
  say so and stop. Do not fill the gap from memory or from web results.
  ```

## Tests

From the skill directory (`skills/job-board/` in this repo), after `npm install`:

```bash
npm test                    # unit, format, cache and end-to-end tests; NO network
npm run test:live           # real ATS APIs, opt-in
```

To run one real search each on Kagi, Brave and Exa (each is billed to its key), set the key
for that provider in its own variable and run the live suite. Without a key the test is
skipped and says so:

```bash
LIVE_KAGI_API_KEY=... LIVE_BRAVE_API_KEY=... LIVE_EXA_API_KEY=... npm run test:live
```

The keys use their own variables, so a key you set for the skill (for example Kagi) is
never spent by these tests.

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

In this repo: `skills/job-board/`. Everything below is relative to that
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
  search.ts           # pluggable search providers (Kagi, Brave, Exa)
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
npm test             # offline: unit, format, cache, provenance, end-to-end
npm run test:live    # real ATS APIs; opt-in, makes network calls
```

`dist/` is what consumers run; `node_modules` is never needed at runtime.



