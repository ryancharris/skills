# TODO — job-search skill

Status: **complete.** 137 offline tests, 161 with live network, pyflakes clean,
loads in pi with 0 diagnostics.

## Review workstreams (this session)

### 1. Product manager — user journeys ✅
Reviewed J1–J6 (laid-off-with-no-names, named company, enterprise, discovery,
follow-up, non-engineer). Findings acted on:

- **Critical doc bug**: the `description` still advertised "seeding from recent
  WARN layoff filings", a feature removed two sessions earlier. It also implied
  open-ended job finding. Rewritten to state the company-names requirement and
  the discovery limitation.
- Added a **"Read this first: what this can and cannot do"** block at the top of
  SKILL.md (works / does not work table), and a **"When the user has no
  companies"** section with three viable routes.
- Dead ends now offer a next step: unknown companies emit a
  **"Next step: find the careers page yourself"** section with a ready query.

Outcome: J1/J4 (discovery) remain **out of scope by design**, but the failure is
now stated before effort is invested rather than discovered afterwards.

### 2. Designer — output review ✅
Two rounds. Round 1 findings and fixes:

| Finding | Fix |
|---|---|
| ~18 lines of metadata before the first job | Jobs lead; headline is `# 39 roles at Notion, Stripe`; diagnostics collapsed to the end under `<sub>Diagnostics</sub>` |
| `GTM` jargon | Expanded to "Sales & Marketing" |
| `partial: board reports 155` read like a failure | Now `at least 100 open roles (155 total; first page read)` |
| `board(s)` | Singular/plural handled |
| `ATS` jargon in errors | "no job board found" |
| lowercase `notion` | `display_company()` title-cases slug-derived names for display |
| Doubled parens `Sales & Marketing (GTM) (319)` | Now `Sales & Marketing - 319` |
| Dead-end empty states | Next-step block |
| CLI jargon in the zero-match warning | "767 open roles were found, but none matched your filters. Try a broader --title…" |

Round 2 verified round-1 fixes as FIXED and caught residual jargon in the
primary path, which was then rewritten.

### 3. AI engineer — portability ✅
Verified rather than assumed:

- **Spec compliance**: name valid, description reduced **492 → 191 chars**
  (paid on every routing turn).
- **Runs copied alone**, no venv, no PYTHONPATH: verified in `/tmp/porttest`.
- **Runs via symlink** into a harness dir: verified in `/tmp/agentdir`.
- **Runtime deps**: none (verified from the built wheel; `pip list` shows only
  the package).
- **Root `pytest`** works and is now warning-free (added root `pytest.ini` so
  the `live` marker registers across skills).
- Documented 4 monorepo conventions in the root README: package name ==
  directory, description < 200 chars, unique test file names, stdlib-only at
  runtime.

### 4. Close ALL TODOs ✅
| Item | Outcome |
|---|---|
| **B6** SmartRecruiters pagination | **Done.** Pages until `totalFound`, capped at `MAX_PAGES`; Aramark verified **603/603, no duplicate ids** |
| **B4** ATS response cache with TTL | **Done.** `jobsearch/cache.py`, opt-in (`JOBSEARCH_CACHE_TTL`/`--cache-ttl`), `--clear-cache`. Verified 1.06s → 0.61s warm, identical results. Fails safe on every error path; POSTs never cached |
| **B2** Workable/BambooHR | **BambooHR done** (verified payload, 13 new tests). **Workable proven infeasible**: widget API returns `jobs: []` for every account tested; pages are JS-rendered with no embedded data. Would need a headless browser, breaking stdlib-only |
| **B5** npm/pip packaging | **Done.** `pyproject.toml`; wheel builds, installs into a clean venv, `jobsearch` console script works, zero runtime deps |
| **B1** Search provider | **Closed.** A real `SEARCH_API_KEY` became available, which exposed bug #10 and validated Kagi end-to-end: live queries return results, the enterprise fallback works (Amazon → 33 roles), and `test_kagi_live_contract` guards the contract. Brave remains implemented-but-unexercised; it shares the same `SEARCH_API_KEY` and error mapping |

## Bugs found during these streams (all fixed + regression-tested)

Each was reproduced first, then fixed, then given a regression test.

| # | Bug | Severity | Fix | Test |
|---|---|---|---|---|
| 1 | `description` advertised the removed WARN seeding feature, and implied open-ended job finding | High (misroutes users) | Rewritten to 191 chars, states the company-names requirement | `test_cli`/description budget check |
| 2 | `--clear-cache` unreachable — the "nothing to search" guard exited first | Medium | Config loaded and cache actions handled before the guard | manual + `--clear-cache` |
| 3 | Unknown BambooHR tenant returns **HTML** → uncaught `JSONDecodeError` killed the whole run | **Critical** | `get_json` converts a non-JSON body into `HttpError` | `test_bamboohr_unknown_tenant_returns_html_not_json` |
| 4 | `@dataclass` orphaned by an alias block inserted mid-decorator → module wouldn't import | High | Reordered: constants, helper, decorator, class | pyflakes + import check |
| 5 | `at least 1 open roles` — singular/plural | Low | Pluralisation helper in `verdict()` | `test_hiring_signal_partial_*` |
| 6 | Six tests asserting superseded output wording | Medium (false failures) | Assertions updated to the new contract | full suite |
| **7** | **New this session:** a JSON parse failure was reported as `HTTP 200 for ...`, which reads as success, with raw HTML in the message | Medium (misleading) | `HttpError.kind = "parse"`; message says "unexpected non-JSON response ... (HTTP 200)"; no HTML leaked | `test_parse_failure_is_not_reported_as_http_200` |
| **8** | **New this session:** `discover_boards` swallowed *all* exceptions, so a DNS blip/timeout was indistinguishable from "this company has no board" — a transient failure told the user Stripe had no jobs | **Critical** | `errors` sink; transient failures reported as "lookup failed ... results may be incomplete"; genuine misses stay silent | `test_discovery_reports_transient_failures`, `test_discovery_stays_quiet_for_genuine_misses` |
| **9** | **New this session:** `_fetch_board` returned `[]` on any failure, so a board known to have 767 jobs looked empty — `--check` could report "not hiring" for a company with 767 openings | **Critical** | `errors` sink per board; reports "counts may be understated" | `test_fetch_board_reports_failure_instead_of_looking_empty` |
| **10** | **Kagi provider was non-functional in production.** Implemented against the legacy v0 shape (`data: [{"t": 0, ...}]`); live v1 returns `data: {"search": [...]}`. Every query returned 0 results or raised `AttributeError`. My own mocks matched my own wrong assumption, so 14 unit tests passed against a contract that does not exist | **Critical** | Parse `data.search`, tolerate lists, strip `<strong>`/entity markup from snippets | `test_kagi_parses_live_v1_shape`, `test_kagi_live_contract` (live) |
| **11** | Search-sourced company names were mangled ATS slugs (`Andurilindustries`, `Sodali_co`), and `&amp;` leaked into titles | Medium | `_company_from_url()` prefers `"... at <Company>"` from the title, unescapes entities, title-cases the slug fallback | `_company_from_url` cases + `test_pipeline_enterprise_*` |

Bugs 7–9 were found by auditing the silent `except` handlers after fixing 3,
which is the same class of defect: an error that is swallowed cannot be
distinguished from a legitimate empty answer.

Bugs 10–11 could **only** be found by calling the real API once a
`SEARCH_API_KEY` was available. Tests written from an assumption verify the
assumption, not the service. This is why `test_kagi_live_contract` now exists:
it is the only test that can catch a contract drift on the provider side.

Both critical fixes (#8, #9) and #10 were **mutation-tested**: the bug was
reintroduced, the test confirmed failing, then the fix restored.

## Prior session record

Issues 1–10 from the previous run are listed in git history / earlier notes:
the `import os` `NameError`, the Greenhouse department gap, `PM`/`Development`
substring matches, and the `(company, slug)` board-key collision that reported
1 posting instead of 170.

## Known limitations (documented, not bugs)
- `--check` cannot read enterprises (`unknown: true`): it reports whole-board
  hiring, and there is no board to read. `--company`/`--title` at the same
  company *does* work via the search fallback when `SEARCH_API_KEY` is set.
- Seniority is title-only; Ramp encodes none, so `--seniority senior` is empty.
- No open-ended company discovery — by design.
- Brave provider is implemented and shares `SEARCH_API_KEY`, but the available
  key is a Kagi key, so Brave returns `HTTP 422` (verified — the error mapping
  handles it cleanly). Brave is therefore code-complete but never exercised
  against a real Brave key.
