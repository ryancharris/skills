# Changelog — job-board skill

## Unreleased

**Environment variables now use the `JOB_BOARD_` prefix.** Every setting moved:
`JOB_BOARD_SEARCH_API_KEY`, `JOB_BOARD_SEARCH_PROVIDER`, `JOB_BOARD_HTTP_TIMEOUT`,
`JOB_BOARD_CACHE_TTL`, `JOB_BOARD_CACHE_DIR`. The former names still work and print a
deprecation warning: `LAID_OFF_*`, `JOBSEARCH_*` and `SEARCH_API_KEY`. This supersedes
the earlier note that `LAID_OFF_*` would stay.

**Conflicting names are an error that never prints a value.** If two names for one
setting are set to different values, the run stops (exit 2) and names the variables.
The old error printed both values, which for the API key meant printing the secret.
The API key previously had no conflict check; it now has one.

**SmartRecruiters links.** Job links stay on `jobs.smartrecruiters.com`. Only the board root
moved to `careers.`; a `careers.` job link redirects back to the board. The reference said
otherwise and is corrected.

**Reference docs match the TypeScript CLI.** `references/` still named the removed Python
modules and a `./jobsearch.py` command. Those now point to `src/` and `dist/main.js`. The
SmartRecruiters read limit is documented there too.

**Renamed from `laid-off` to `job-board`.** The directory, skill name, CLI name
(`job-board --version`), package name, User-Agent, and default cache directory
(`~/.cache/job-board`) all changed. The `LAID_OFF_*` environment variables did not:
existing setups keep working. Entries below this one use the former name.

**Fixed.** `--help` said `usage: jobsearch`, an older name. It now says `job-board`.

**Routing after the rename.** The new name reads like a job-listing site, and in opencode
that pulled generic "find me any tech company hiring" prompts toward the skill (4 of 4
improvised a company list, against 0 of 6 for the old name). The description now opens
with the layoff trigger and says it does not search or find companies. Measured after
the change: layoff checks routed 3 of 3 in pi and 3 of 3 in opencode; no-company prompts
improvised in 2 of 6 opencode runs (0 of 6 under the old name), and 0 of 4 in pi.

**Agents no longer pick companies when none were named.** Measured in opencode over
10 runs of "find me any tech company hiring engineers": 6 runs chose companies themselves
(from memory, a web search, or a placeholder) and ran the CLI on them. The "no
companies" section now forbids that and tells the agent to ask in plain text, not with
a question tool (which returns nothing in a non-interactive run). After: 3 of 10. The
remaining 3 web-searched before the skill loaded; that is the harness, not the skill.
pi: 4 of 4 correct before and after.

**Human formats state what JSON states.** `md`, `detail` and `html` now show partial
reads, cached data (with the fetch time), and every warning, for both role search and
`--check`. Before, only JSON carried them. Each partial board is stated once.

**Real-board check.** Ran the built CLI against a live SmartRecruiters board of 756
postings (ServiceNow): read in full, not flagged partial, and the cache path reports
its fetch time. No public board above 1,000 was found, so the 1,000-posting cap is
validated only against a synthetic board.

**Untrusted text is cleaned on ingestion.** Titles, companies, locations and snippets
collapse to one line. Titles are capped at 200 characters and snippets at 300. Only
`http(s)` URLs are kept, so a `javascript:` URL can no longer reach an `href`. Markdown
link text and destinations are escaped, so a title cannot inject a heading or break a
link. Each claim was checked against the code before the fix.

**Markdown uses badges.** `md` now shows the same emoji badges as `detail`
(remote, pay listed, new, possibly stale; hiring and unreadable for `--check`), with
a legend line. The JSON formats stay emoji-free.

**Cache provenance.** JSON output now says whether the ATS data came from the
`--cache-ttl` cache: `cached` (any response from the cache) and `fetched_at` (the
oldest fetch time among the responses used). A cache entry written earlier in the
same run counts as a fresh fetch, not a cached one. Human formats do not show this
yet.

**Partial results are flagged.** A SmartRecruiters board larger than the
1,000-posting read limit was silently cut short in role search (only `--check`
noticed). Role search now reports `partial: true` and `partial_boards` in JSON,
with a "Partial:" line in every human format. The total comes from the same
requests as the postings, so a change between two calls cannot cause a false flag.

**Format audit.** Six issues found by systematically checking every format
against every mode, and fixed:

- `--check --format detail` silently fell back to Markdown — the same bug just
  fixed for `html`. `--check` now dispatches per format.
- `--queries` and `--list-boards` silently ignored `--format`; they now say so.
- `--limit -1` returned **all but the last** result (`slice(0, -1)`). Negative
  and non-integer values are now rejected, exit 2.
- `--max-companies -1` silently behaved like `1`. Now rejected.
- `friendlyDepartment` missed `Go To Market` — the exact string OpenAI uses.
- `md` omitted Team and Type, so switching format silently changed which facts
  existed.

`--limit 0` is documented as "no results".

Checked and cleared during the same audit: HTML escaping (a deliberate breakout
attempt with a quote and `<script>` in the url is neutralised), HTML
well-formedness (strict parser, no mismatched tags), empty states across all
formats, and `--check` warning about ignored role filters.


**New output formats.** `--format` is now a registry rather than three hardcoded
branches:

| Format | For | |
|---|---|---|
| `json` / `json-compact` | agents | unchanged |
| `md` | humans | unchanged; one line per role |
| `detail` | humans | **new** — one block per role, emoji, copyable link |
| `html` | humans | **new** — standalone page, no scripts or external assets |

Emoji appear only in `detail` and `html`. The JSON key set is unchanged and
covered by a regression test; a second test asserts no emoji can reach it.

`--check --format html` now emits HTML; it previously fell back to Markdown.

Fixed: `displayCompany` title-cased brand names into "Openai" and
"Andurilindustries". Now consults a brand map and handles slug separators.


**All user-facing variables now share the `LAID_OFF_` prefix.** The remaining
three were the last under `JOBSEARCH_`:

| Old | New |
|---|---|
| `JOBSEARCH_HTTP_TIMEOUT` | `LAID_OFF_HTTP_TIMEOUT` |
| `JOBSEARCH_CACHE_TTL` | `LAID_OFF_CACHE_TTL` |
| `JOBSEARCH_CACHE_DIR` | `LAID_OFF_CACHE_DIR` |

Each former name still works and warns. `JOBSEARCH_LIVE_TESTS` is unchanged —
it is a test-harness flag, not user configuration.

**Invalid numeric settings are now rejected** (exit 2) instead of silently
becoming `NaN` and failing later inside a request. `LAID_OFF_HTTP_TIMEOUT` must
be positive; `LAID_OFF_CACHE_TTL` may be 0 (disabled) or positive.


**Search provider variable renamed to `LAID_OFF_SEARCH_PROVIDER`.** It was
`JOBSEARCH_SEARCH_PROVIDER` while the API key was already `LAID_OFF_*`, so the
two halves of one feature sat under different prefixes. They now match. The
former name still works and warns. An unknown provider is now a hard error
(exit 2) rather than a silent fallback to kagi — searching with the wrong engine
bills the wrong account.


**Clearer result when `LAID_OFF_SEARCH_API_KEY` is unset.** Previously an
enterprise search with no key printed `# 0 roles` with *"No postings matched.
Try widening titles/locations"* — advice that cannot help, because nothing was
ever read. The empty state now names the cause and the remedy, and the JSON
carries a machine-readable `empty_reason` (`no_key` / `no_board` / `filtered`).


**Search API key renamed to `LAID_OFF_SEARCH_API_KEY`.** The old
`SEARCH_API_KEY` is still read but emits a deprecation warning on stderr; when
both are set the new name wins. This is deliberately not a hard cut — an
unannounced rename is indistinguishable from "no key configured" for anyone who
already exported the old variable.

```bash
# before
export SEARCH_API_KEY=...
# after (same key value)
export LAID_OFF_SEARCH_API_KEY=...
```

**Renamed `job-search` to `laid-off`.** The skill answers "I was laid off — who is
still hiring?", so the name now states the situation rather than the mechanism.

- Directory: `job-search/` → `laid-off/`; `SKILL.md` `name:` updated to match.
- npm package: `jobsearch-skill` → `laid-off-skill`; bin `jobsearch` → `laid-off`.
- `--version` now prints `laid-off 2.0.0`.
- **Search key renamed** to `LAID_OFF_SEARCH_API_KEY`. The previous
  `SEARCH_API_KEY` still works but prints a deprecation warning; it will be
  removed in a future release. Other variables (`JOBSEARCH_*`) are unchanged.

## 2.0.0

**Rewritten in TypeScript.** Same behaviour, same output, same flags — verified
by parity tests against the previous Python implementation on live data.

- Source moves to `src/*.ts`, compiled to `dist/*.js`. The shipped JavaScript has
  **zero runtime dependencies**, so the skill still runs by copying it anywhere
  Node is available — no `npm install` at use time. `typescript` and `vitest` are
  dev-only.
- Requires **Node.js 20+** instead of Python 3.10+.
- Output is unchanged: JSON keys, key order, `count`/`total`/`truncated`,
  `json-compact`, and both Markdown renderings are byte-identical to 1.1.0
  (verified by `diff` on live results, and by golden-vector tests).
- `--version` added.

### Notes for maintainers
The port preserved Python semantics that are *not* 1:1, and each is deliberate:

- `discovery.ts` uses `normalize("NFKD")` + a `\p{M}` strip, because JS
  `toLowerCase()`/normalisation differ from Python on accented input. "Société
  Générale" must still fold to slug `societegenerale`.
- `html.ts` exists because Node has no HTML entity decoder. It decodes one level
  only and leaves unknown entities intact, matching `html.unescape`.
- `filtering.ts` builds a lookbehind regex per call: word-boundary matching is
  load-bearing (`PM` must not match "Develo**pm**ent").
- `output.ts` formats `generated_at` by hand to match Python's microsecond
  `+00:00` form rather than `toISOString()`'s milliseconds and `Z`.
- `rankJobs` carries an explicit index tie-break so ordering is deterministic
  without relying on sort stability.
- `dist/` is committed: the compiled JavaScript is what users run, so it must
  not be gitignored.

### Migration notes
- `./jobsearch.py` → `node dist/main.js`
- `python -m pytest` → `npm test` (or `npm run test:live`)
- Env vars are unchanged (`SEARCH_API_KEY`, `JOBSEARCH_*`).

## 1.1.0

Board-reading for five ATSes (Greenhouse, Lever, Ashby, SmartRecruiters,
BambooHR) plus an optional search-engine fallback, and a `--check` mode that
reports whether a company is hiring and in which departments.

**Verification:** 137 tests offline, 161 with `JOBSEARCH_LIVE_TESTS=1`.
`pyflakes` clean. Loads via the Agent Skills loader with zero diagnostics.

### Behaviour worth knowing

- **`--check` never overstates.** If a board only partially read (API page
  limit), the verdict says *"at least N open roles (M total; first page read)"*
  rather than quoting a truncated number. If no board resolves at all, it
  reports `unknown: true` — never `0 open roles`.
- **Transient failures are surfaced, not swallowed.** A network error while
  probing a board produces a warning (*"results may be incomplete"*), because a
  silent failure is indistinguishable from "this company has no openings".
- **Board identity is verified.** A slug that matches an unrelated company's
  board is rejected: probing `general motors` does not accept a board named
  "General Interest".
- **Salaries come from structured data.** Ashby publishes pay per geography; the
  one-line summary quotes the USD tier even for Canada-eligible roles, so the
  CAD tier is read from `compensationTiers[].components[]` instead.

### Fixed

- Search provider was implemented against a legacy payload shape and returned
  nothing against the live API. The current contract is captured from the real
  service and guarded by a live test.
- Greenhouse `/jobs` carries no department, so every role was reported as
  unspecified; departments are now resolved in one `/departments` request.
- Short synonyms matched as substrings (`PM` inside *Development*, `go` inside
  *MongoDB*); matching is now word-boundary aware.
- Pagination ignored: a 603-role board reported 100.
- Two boards for the same company could overwrite each other, losing postings.
- A non-JSON response (per-tenant host returning HTML) crashed the run.

## Known limitations

- **No open-ended discovery.** The skill needs company names. It is a job
  *inspector*, not a finder — this is stated in `SKILL.md` before any command.
- **`--check` cannot read enterprises.** There is no whole board to read for
  companies on custom career sites, so it returns `unknown: true`. A targeted
  `--company`/`--title` search at the same employer works via the search
  fallback when `SEARCH_API_KEY` is set.
- **Seniority is title-only.** Some employers (e.g. Ramp) encode no seniority in
  titles, so `--seniority` correctly returns nothing for them.
- **Workable is unsupported.** Its careers pages are JS-rendered and its widget
  API returns an empty job list; supporting it would require a headless browser,
  which breaks the stdlib-only rule.
- **Brave provider is code-complete but unexercised** against a real Brave key
  (only a Kagi key was available). It shares `SEARCH_API_KEY` and the same error
  mapping.
