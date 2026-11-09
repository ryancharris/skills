# Changelog — laid-off skill

## Unreleased

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
