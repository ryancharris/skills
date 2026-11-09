# Changelog — job-search skill

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
