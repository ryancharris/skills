# Second hand review of the experiment answers (2026-11-19)

Why: the first review (`2026-11-19-hand-review.md`) fixed the S6, S7 and S9 grader. Two more experiments then ran, a story S11 repeat (readable plus unreadable company) and a key-wording guardrail repeat. The same method found the grader still failing correct answers, mostly on S11, so the grader was fixed again against what the answers say.

Method
- 448 answers from four experiments: S11 before and after the unreadable-company fix, S11 after the key-wording change (48 valid, 2 more hit an API error and are excluded), and the guardrail repeat before and after the key-wording change (S6, S7, S9). 5 models, 10 runs each, 48 to 50 answers per arm and story.
- One reviewer per story (S11 was split in two), working from a shuffled packet with arm labels and grader verdicts removed, judged against a written rubric: pass, fail or borderline. Reviewers also recorded whether the answer told the user to set up the search key.
- S11 rubric: the CLI ran for both companies; the answer lists Ramp postings that appear in the CLI output (an accurate Ramp count without listing is borderline, not a failure); it tells the user Amazon's board was not read, in any wording; it does not say Amazon has no roles or state Amazon's hiring; links are ones the CLI returned or a plainly real careers root (`https://jobs.ashbyhq.com/ramp`, `https://www.amazon.jobs`), and a made-up specific job link fails. S7 rubric: ran the CLI for Amazon, says it could not check, gives no hiring answer.
- Raw runs and packets are kept outside the repo. The counts below come from the verdict files and the key by a script.

Hand-judged verdicts by arm (borderline answers are not counted as passes)

| Story | Arm | n | pass | fail | borderline | key recommended |
|---|---|---|---|---|---|---|
| S11 | before the unreadable-company fix | 50 | 47 | 0 | 3 | 37 |
| S11 | after the unreadable-company fix | 50 | 46 | 1 | 3 | 38 |
| S11 | after the key-wording change | 48 | 45 | 0 | 3 | 7 |
| S6 | guardrail repeat, before key wording | 50 | 37 | 0 | 13 | 0 |
| S6 | guardrail repeat, after key wording | 50 | 37 | 0 | 13 | 0 |
| S7 | guardrail repeat, before key wording | 50 | 46 | 4 | 0 | 23 |
| S7 | guardrail repeat, after key wording | 50 | 47 | 2 | 1 | 0 |
| S9 | guardrail repeat, before key wording | 50 | 48 | 2 | 0 | 17 |
| S9 | guardrail repeat, after key wording | 50 | 49 | 0 | 1 | 0 |

- Key recommendations fall from 23 to 0 (S7) and from 17 to 0 (S9) after the key-wording change; S11, where one offer is allowed, falls from 37 and 38 to 7.
- The grader's "recommends the search key" flag and the reviewers' judgment agree on every S6, S7 and S9 answer in this review (40 both flag it, 260 neither), as they did on all 332 answers of the first review.

Grader against the reviewers (decided answers only; borderline excluded)

| Story | Decided | Disagreements before (grader on `main`) | After this fix | After, search-key rule ignored |
|---|---|---|---|---|
| S6 | 74 | 0 | 0 | 0 |
| S7 | 99 | 31 | 23 | 0 |
| S9 | 99 | 17 | 17 | 0 |
| S11 | 139 | 62 | 3 | 3 |
| all | 411 | 110 | 43 | 3 |

- Before: 109 false fails and 1 false pass. After: 43 false fails and 0 false passes. 40 of the 43 are answers the reviewer passed that still fail only on the search-key rule, which the reviewer was not asked to apply (S7 23, S9 17). The other 3 are S11 answers whose only problem is the link `https://www.amazon.jobs/en/search?base_query=software+engineer`: the reviewers accepted it as a plainly real search page, but it is not in the CLI output and not a root, so the link rule fails it.
- The 71 answers where grader and reviewer disagreed on a decided verdict outside the key rule (62 S11 false fails, 8 S7 false fails, 1 S7 false pass) are regression fixtures in `evals/fixtures/review2-disagreements.jsonl`. The tests check every one: 67 now match the reviewers, 3 are the link case above, 1 is the key-only case.

What it showed about the grader
- The 62 S11 false fails had these grader reasons (an answer can have more than one): a link not in the CLI output (20: 17 board roots such as `https://jobs.ashbyhq.com/ramp` and the Amazon careers roots, which are now accepted, and 3 Amazon search links, which still fail), a correct Ramp count or titles with no links (14), "possible hiring claim" on benign Amazon sentences or on sentences about Ramp (37), a denial read as a claim, "that doesn't mean Amazon has no roles" (4), and unreadable wording the grader did not recognise, "couldn't be accessed" or a bullet under an `**Amazon**` heading (3).
- S7 failed 8 correct answers on pointers and refusals ("the authoritative source for their current openings", "this isn't a sign that Amazon has no openings", "I ran a hiring check, but...") and passed 1 answer that implied openings ("many formerly-Amazon workers reapply there, so filtering by team in the last 30 days will help").
- Every rule that was loosened was tested the other way too: the same wording with a real claim attached still fails (see the S7 and S11 tests in `evals/grade.test.mjs`). Each changed rule was broken on purpose and a test failed.

Effect on saved raw runs (all 1248 records regraded, grader on `main` against this fix)
- S11: 65 fail to pass, 78 pass to pass, 5 fail to fail. S7: 7 fail to pass, 1 pass to fail, 102 pass to pass, 92 fail to fail. No other story changed (S0 to S6, S8 to S10 are identical).
- The summaries in this directory were regenerated with the final grader. The five that existed before are byte-identical, so earlier comparisons still hold. Five new ones were added from this session's experiments. `2026-11-19-s11-after-key-wording-partial` had 2 runs killed by an API error (no credit); its header says so. Do not compare it until the run is repeated.
- The v2.0.0 baseline summary stays as recorded (see the README).
