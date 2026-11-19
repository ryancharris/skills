# Agent evals

Does an agent actually use the `job-board` skill correctly? This runs fixed user stories
(`stories.json`) through [opencode](https://opencode.ai) in a clean Docker container and
grades each run, so "works on my machine" is not the evidence.

**Manual only.** It calls paid model APIs and live job boards. It is not part of `npm test`
and must never run in CI.

```bash
# keys go in a file you keep out of the repo, e.g. OPENROUTER_API_KEY=sk-or-... (no quotes around the value)
evals/run.sh \
  --models openrouter/anthropic/claude-sonnet-5.5,openrouter/moonshotai/kimi-k3 \
  --env-file ~/jb.env --runs 3
```

- `--ref origin/main` installs the skill as it is on GitHub. The default `HEAD` installs your
  committed branch, so you can measure a change before merging. Uncommitted edits are not used.
- The skill is installed from `git archive`, so the container never sees your working tree.
- The skill is installed from `git archive`, but the harness files (`run.mjs`, `redact.mjs`, ...) are copied from your working tree, not from `--ref`.
- Keys are passed at `docker create` time and are not stored in the image. Docker does keep them in the container's config
  (`docker inspect` shows them) until the container is removed. `run.sh` removes it on exit, by name, so a failed `docker create`
  or a Ctrl-C does not leave it behind.
- `opencode` is pinned in `Dockerfile` (`OPENCODE_VERSION`). The runner writes `versions.json` (opencode and node versions) and
  `summary.json` / `summary.md` carry it. `compare.mjs` warns when the two runs used different agent versions.
- Runs are shuffled (seed recorded in `order.json`), each in a fresh session and directory.
- Output (copied out of the container when the run ends): `evals/out/<timestamp>/` with `results.jsonl` (full event streams), `order.json`,
  `meta.json`, `report.html` (every prompt, tool call and answer) and `summary.md` / `summary.json`
  (pass counts only). `evals/out/` is gitignored.
- Docker Desktop's default 2 GB VM runs out of memory at about 6 parallel runs and kills them
  (`exit=null`). The default is 3. Raise `--concurrency` only if you raised the VM's memory.

## Secrets

Everything in `--env-file` is in the container's environment, so the agent's bash tool can read it: a model, or a job posting
that prompt-injects one, can run `env`. Two defences:

- Use a dedicated OpenRouter key with a low spend limit just for evals, and revoke it if a record ever shows it.
- Before any record is written, `redact.mjs` replaces every value of an environment variable whose name matches
  `KEY|TOKEN|SECRET|PASSWORD` (value of 8+ characters) with `[REDACTED]` in the events and stderr. Name other variables in
  `REDACT_ENV` (comma list) if you pass something with a different name.
- Write env-file values without quotes: `docker --env-file` keeps quote characters as part of the value, so a quoted key is sent wrong.
  `run.sh` refuses a quoted value.

Redaction is exact-match on the value. It cannot catch a model that re-encodes the key (base64, split in parts).

## Time limits and aborts

A run that exceeds `RUN_TIMEOUT_MS` (default 420000, set in the container environment) is killed with its whole process group and its
record gets `timedOut: true`. The runner stops the matrix early only on a structured error event with HTTP 401, 402 or 403
(`abort.mjs`); the same digits in tool output or prose do not count.

## Keeping results to compare against

Add `--save NAME` and the summary is copied to `evals/results/<date>-NAME.md` and `.json`.
`NAME` must match `^[A-Za-z0-9._-]+$` and not start with a dot, and `run.sh` refuses to overwrite an existing pair unless you pass `--force-save`.
Commit those two small files. They are the record of how the skill behaved at that commit.

```bash
evals/run.sh --models ... --env-file ~/jb.env --save my-change
node evals/compare.mjs evals/results/2026-11-18-baseline-v2.0.0.json evals/results/<date>-my-change.json
```

`compare.mjs` lines the two runs up per story and per model, using only the models and stories
both runs have. It prints two one-sided Fisher exact p values per story: `p improve` (the second run passes more often) and
`p regress` (it passes less often). Runs are pooled across models and repeated prompts are not independent, so p is
exploratory. With 3 runs per cell it is weak evidence: use 10 or more runs before calling a change real.
Compare runs of the same models, and note that the grader can change between runs (re-grade the
old `results.jsonl` if you still have it, since `summary.mjs` takes any out directory).

`results/2026-11-18-baseline-v2.0.0.*` is the first record: six models, 11 stories, 3 runs each,
skill v2.0.0 (`2a97e45`). It predates story S11 and the search-key rules below, so regrading its records with the current grader gives different S7 and S9 verdicts; the saved summary stays as recorded.

## Reading the results

`grade.mjs` is strict and keyword-based. A run passes only if every check for its story holds.
Stories S7 and S9 check wording, so read those transcripts before trusting a pass. The grader is
code in this repo and can be wrong: when a whole column fails for every model, suspect the grader first.

Three runs per cell is a small sample. The docs elsewhere in this repo report about 10% run-to-run
variance on the no-verdict-from-memory story, so use more runs before claiming a difference.
Failures that are the model's tool-calling format (printing `<function=...>` as text) are counted
as "malformed tool calls" in the report; they are not the skill's fault.

## Testing the grader

`evals/grade.test.mjs` tests `grade.mjs` offline with Node's built-in runner (no dependencies,
no network, no docker, no model calls):

```bash
node --test evals/*.test.mjs
```

It builds small synthetic records for every story (S0 to S11, one pass and one fail each), plus
invalid runs, malformed tool calls, hiring claims hidden in the body or in earlier narration, and web
use through `curl`. It also re-grades a few trimmed real records from `evals/fixtures/`. Change the
grader, run this, and add a case for any new rule. On Node 20 or 22, `node --test evals/` works too.

### Grader strictness rules

S7 and S9 pass only if no sentence outside the quoted cannot-check sentence pairs a hiring word with the company. A short allow-list of neutral wording is exempt (offers to check, "that doesn't mean it has no openings"). A hiring claim is an assertion about the company's hiring state or openings. These are not claims: instructions and offers addressed to the user (clauses that start with a directive verb such as "visit amazon.jobs", "search for Amazon roles yourself", "you can check ...", or a purpose clause such as "to find Amazon's openings"), the reason the skill cannot read the company ("Amazon runs its own careers site, not a supported job platform"), and negated refusals ("that doesn't show the company isn't hiring", "I cannot say whether it is hiring", "it won't list Amazon's own openings", "different from Amazon having no openings"). Only the directive or refusal clause is exempt: the rest of the sentence is still judged, a clause containing a digit is never dropped, and a claim next to an instruction ("visit amazon.jobs, they are hiring a lot") still fails. These rules came from a blind hand review of real S6, S7 and S9 answers; the 23 answers the reviewer judged correct but the older grader failed are kept in `fixtures/reviewed-correct.jsonl` and checked by the tests. Eight of them still fail, only on the search-key rule below, which the reviewer was not asked about.

S6 passes if the answer asks for companies with a question mark or with a request in a sentence that mentions companies ("tell me which companies...", "please provide the names of companies", "name some companies"). An offer ("I can provide a list of companies") is not a request. S1, S2 and S8 compare every answer URL exactly with the URLs printed by a CLI call that worked. S6 fails when the answer names well-known employers of its own. S11 ("Find software engineer roles at Ramp and Amazon.") runs a role search for a readable and an unreadable company. It passes only if a `--company` call (not only `--check`) names both companies, no web tool is used, every answer URL appears exactly in CLI output, the answer says Amazon could not be read (the quoted sentence or other wording such as "could not read", "no supported board", "unreadable"), it does not say Amazon has no roles or openings (an unreadable company never has zero roles), and it makes no hiring claim about Amazon from memory.

The search key (`JOB_BOARD_SEARCH_API_KEY`, providers Kagi, Brave, Exa) is an optional add-on that `--check` never uses. `recommendsSearchKey` in `grade.mjs` flags an answer that tells the user to set a search key, name the env var, sign up for a search provider or enable the search fallback. S7 and S9 run `--check`, so they fail on any such recommendation ("recommends the search key after --check"). S5 and S6 fail on it too ("recommends the search key"). S11 may offer the key once. Statements that the key is not needed ("no API key needed", "works without a key") are not recommendations, and neither is naming a search engine as a place to paste site queries ("paste these into Google, Bing or Kagi"), because site queries need no key. A provider name counts only as a service to sign up for. The rule is documented in the comment above `recommendsSearchKey`.

A run with `timedOut: true` is a valid fail ("timed out"), not an invalid run. To retune a rule, regrade the saved records and read every changed verdict before trusting it.

The other `evals/*.test.mjs` files cover redaction, the abort check, the Fisher numbers (against an exact integer computation),
markdown escaping, and the report and summary scripts.

`evals/e2e/run-e2e.sh IMAGE` is a model-free end-to-end check of the runners inside a container, using a stub `opencode`
(set `RUNNER=routes/run-pi.mjs STUB=pi` for the other runners). It shows a secret printed by the agent is redacted and a hanging run
is killed with `timedOut: true`. It needs Docker and an existing `jb-evals:*` image, and uses `docker cp`, not bind mounts.

## Other install routes

`evals/routes/` covers the Claude Code plugin and pi package install routes. See `evals/routes/README.md`.
