# Agent evals

Does an agent actually use the `job-board` skill correctly? This runs fixed user stories
(`stories.json`) through [opencode](https://opencode.ai) in a clean Docker container and
grades each run, so "works on my machine" is not the evidence.

**Manual only.** It calls paid model APIs and live job boards. It is not part of `npm test`
and must never run in CI.

```bash
# keys go in a file you keep out of the repo, e.g. OPENROUTER_API_KEY=...
evals/run.sh \
  --models openrouter/anthropic/claude-sonnet-5.5,openrouter/moonshotai/kimi-k3 \
  --env-file ~/jb.env --runs 3
```

- `--ref origin/main` installs the skill as it is on GitHub. The default `HEAD` installs your
  committed branch, so you can measure a change before merging. Uncommitted edits are not used.
- The skill is installed from `git archive`, so the container never sees your working tree.
- Keys are passed at `docker run` time and are not stored in the image.
- Runs are shuffled (seed recorded in `order.json`), each in a fresh session and directory.
- Output (copied out of the container when the run ends): `evals/out/<timestamp>/` with `results.jsonl` (full event streams), `order.json`,
  `meta.json` and `report.html`. `evals/out/` is gitignored.

## Reading the results

`grade.mjs` is strict and keyword-based. A run passes only if every check for its story holds.
Stories S7 and S9 check wording, so read those transcripts before trusting a pass. The grader is
code in this repo and can be wrong: when a whole column fails for every model, suspect the grader first.

Three runs per cell is a small sample. The docs elsewhere in this repo report about 10% run-to-run
variance on the no-verdict-from-memory story, so use more runs before claiming a difference.
Failures that are the model's tool-calling format (printing `<function=...>` as text) are counted
as "malformed tool calls" in the report; they are not the skill's fault.
