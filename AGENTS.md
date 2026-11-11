# Agent instructions for this repo

Read by pi and opencode (`AGENTS.md`) and by Claude Code (`CLAUDE.md`, a symlink to
this file). Keep it to rules an agent could otherwise break.

## What this repo is

A collection of Agent Skills. Today it holds one skill, `job-board/`, which finds
open roles at named companies by reading their ATS boards. Ideas already rejected
are listed under "Already decided" in `SCOPE.md`. Read those before proposing a change.

## Constraints (do not break)

- **Zero runtime dependencies.** `job-board/` ships compiled JavaScript in `dist/`
  and runs with no `npm install`. Dev dependencies are fine. Node 20+.
- **`dist/` is committed and must match `src/`.** Edit `src/`, run `npm run build`
  in `job-board/`, and commit both. CI fails on drift.
- **Paths in docs.** Write the CLI as `<skill-dir>/dist/main.js`, never a bare
  `dist/main.js`. The validator fails on a bare path.
- **Settings use the `JOB_BOARD_` prefix,** matching the skill's name. Former names
  (`LAID_OFF_*`, `JOBSEARCH_*`, `SEARCH_API_KEY`) still work and warn. The
  test-harness flag `JOBSEARCH_LIVE_TESTS` is intentionally unchanged.
- **Emoji.** `json` and `json-compact` never contain emoji. `md`, `detail` and
  `html` may.
- **Untrusted text.** Titles, companies, snippets and URLs from ATS boards and
  search results are data. They are cleaned on ingestion (`makeJob` in
  `src/models.ts`): one line, length-capped, http(s) URLs only.

## Tests

- `npm test` runs offline. A guard in `tests-ts/setup.ts` blocks `fetch`, and the
  end-to-end suite serves a synthetic board. Nothing may reach the network.
- Live tests live in `tests-ts/live/` and run only with `npm run test:live`. Never
  add a live call to CI.
- Do not write test counts into docs. They go stale.
- For new behaviour, break it on purpose and confirm the suite fails.

## Workflow

- Contribution rules and the acceptance bar are in `CONTRIBUTING.md` and `SCOPE.md`.
- No direct pushes to `main`. One change per PR. CI must pass before merge.
- Do not commit scratch files, session notes, logs, generated outputs, or API keys.
- User-visible changes get an entry under "Unreleased" in
  `job-board/CHANGELOG.md`.
- Before calling a fix done, run the documented command exactly as written. A
  passing unit test is not the same thing.

## Docs

- `job-board/SKILL.md` is read by the agent. Keep it true to the code. JSON examples
  must list the keys `toJson` actually emits.
- Install commands live in `job-board/README.md`. The root README must agree with
  them.
