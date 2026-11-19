# Third hand review of the experiment answers (2026-11-19)

Why: the Claude Code and pi route runs (`evals/routes/`) were graded by a grader tuned only on opencode answers. Before trusting the route tables, the grader's verdicts on those runs were checked by hand, the same way as in `2026-11-19-hand-review.md` and `2026-11-19-hand-review-2.md`.

Method
- Source: the two full route runs, Claude Code with `anthropic/claude-sonnet-5.5` (3 runs per story, 36 runs) and pi with four models (2 runs per story, 96 runs), 12 stories each. 132 valid runs; the grader on `main` failed 13 of them.
- 27 answers: all 13 grader failures plus 14 passes chosen at random (fixed seed) from S2, S4, S5, S7, S9 and S11, the stories where a link, wording or tool-use check could be wrong. 6 answers are from the Claude Code route and 21 from pi.
- One reviewer, working from a shuffled packet with the route, arm and grader verdict removed, judged each answer pass or fail against the same rubrics as the first two reviews (the CLI ran; links come from CLI output; for S7, S9 and S11 the answer says the company could not be checked and gives no hiring verdict; no invented facts). Borderline was allowed; the reviewer used it 0 times.
- The packet kept tool outputs to 700 characters each. Raw runs and the packet are outside the repo.

Result: reviewer against the grader on `main`

| | pass by hand | fail by hand | total |
|---|---|---|---|
| grader passed | 14 | 0 | 14 |
| grader failed | 9 | 4 | 13 |

- No false passes. 9 false fails. The 4 true fails are all `qwen/qwen3-coder` on pi: S11 with web tools and no CLI search, S4 without `--list-boards`, S5 with a malformed tool call, S5 without `--queries`.
- By story, the 9 false fails: S11 4, S2 2, S9 2, S7 1.

The false-fail groups and the fix (`evals/grade.mjs`)

| Group | Answers | What the answer said | Why the old grader failed it | Fix |
|---|---|---|---|---|
| S2 link | 2 (deepseek, pi) | Linked `https://boards.greenhouse.io/figma/jobs/6134770004`; the CLI printed `...?gh_jid=6134770004` | exact URL compare | the query and fragment may be dropped, but the path must match a printed path exactly and a query the answer carries must be one the CLI printed for that path |
| S9 wording | 2 (qwen3-coder, pi) | "I cannot determine if Zzqxv Holdings International is hiring. The skill couldn't find a job board..." / "I could not verify... couldn't find any job board" | required the quoted sentence | S9 needs plain wording that it could not check or there is no board; a verdict, a hedge from memory or an invented count still fail. S7 keeps the quoted sentence |
| S11 / S7 "no roles" | 3 S11 (1 Claude Code, 2 pi) | "I have no postings for Amazon, which is different from there being none"; "Amazon has no board the skill can read, so no Amazon postings are in these results"; "...cannot say whether it is hiring or which roles are open" | "claims Amazon has no roles" or "possible hiring claim" on an explanation that the board is unreadable | the no-roles pattern needs the roles word within three words of "has no" (no crossing a comma); a contrast with "there being none" is exempt; "check ... whether" no longer swallows a "cannot say" |
| narration | 1 S7 + 1 S11 (both qwen3-coder, pi) | "I've checked Amazon's hiring status using the job board skill, and here's what I found:" / "I've checked for software engineer roles at both Ramp and Amazon." | "possible hiring claim from memory" | past-tense narration ("I've checked / searched / ran ...") up to the next comma, dash, colon or and/but/so/because, with no digit, is not a claim |

Each change has tests that keep the strict reading: "Amazon has no roles", "There are no postings at Amazon, so it is not hiring", "Amazon has no board, and no roles either", "I've checked Amazon and it is hiring", "I've checked Amazon - they are hiring a lot", a truncated or different Greenhouse path, a made-up `?gh_jid=999`, and an S9 answer that says "they are hiring" or "has 12 open roles" all still fail. Each changed rule was broken on purpose and a test failed (11 of 11 mutations caught).

Grader against the reviewers after the fix

- All 27 route answers now match the reviewer (23 pass, 4 fail). The 27 are regression fixtures in `evals/fixtures/review3-routes.jsonl` and the test `review 3 fixtures` requires every one.
- Across all three reviews (830 decided answers; 57 borderline are excluded): agreement 718 of 830 with the grader on `main`, 727 of 830 after the fix. No answer a reviewer and the grader agreed on before is now a disagreement (0 regressions). The 103 that remain: 100 are the search-key rule (reviewers of the first two reviews were not asked to apply it) and 3 are the made-up `amazon.jobs/en/search?base_query=...` link from review 2, both as before.
- All saved raw runs (1380 records: the opencode experiments and both route runs) regraded with the grader on `main` and with the fix: 9 verdicts changed, all fail to pass, all in the route runs, and all 9 are the answers above (S11 4, S2 2, S9 2, S7 1). Nothing changed in the 1248 opencode records.
- A literal "ignore the query on both sides" rule would also have changed one more record: the S8 answer in `jb-docker/matrix.jsonl` that links `https://stripe.com/jobs/search?gh_jid=` with the job id missing. That link is a truncated one, so the rule above keeps it failing.

Route results after the fix (grader on the final code; passes per cell)

Claude Code, `anthropic/claude-sonnet-5.5`, 3 runs per story, 36 valid runs. The grader on `main` gave 35 of 36 (S11 3 of 3 became 2 of 3 under it).

| Model | S0 | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 36/36 |

pi, four models, 2 runs per story, 96 valid runs. The grader on `main` gave 84 of 96.

| Model | S0 | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 24/24 |
| deepseek/deepseek-v4.1-flash-1017 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 24/24 |
| moonshotai/kimi-k3 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 24/24 |
| qwen/qwen3-coder | 2/2 | 2/2 | 2/2 | 2/2 | 1/2 | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 1/2 | 20/24 |

The only remaining failures are the four qwen3-coder answers the reviewer also failed (S4, S5 x2, S11), so the pi gap between qwen3-coder and the other three models is real in this sample.

Limits
- One reviewer, no second opinion, and no inter-reviewer agreement figure.
- The reviewer saw tool outputs trimmed to 700 characters, so a link or count late in a long output could not be checked in the packet; the checks against full outputs were done by the grader.
- Only 27 of 132 answers were read. The 14 passes were drawn from six stories, not all twelve, so a false pass in S0, S1, S3, S6, S8 or S10 on these routes is not ruled out.
- The pi route has 2 runs per cell and the Claude Code route 3 runs of a single model. A cell of 2/2 against 1/2 is not a difference; treat the tables as a smoke test, not a comparison.
- The grader was changed after seeing these 9 answers, so the 27 are no longer a held-out test of it. The held-out evidence is that no earlier reviewed answer changed verdict.
- The URL rule accepts a bare path when the path was printed with a query, so a generic page such as `https://stripe.com/jobs/search` passes even though the CLI printed job-specific `?gh_jid=` links.
