# Hand review of the experiment answers (2026-11-19)

Why: the first grader scored an unreadable-company story (S7) 10/12 -> 5/12 after a description change. Reading the answers showed the grader was failing correct ones. So every S5, S6, S7, S9 and S10 answer from three experiments was judged by hand, and the grader was fixed against what the answers actually said.

Method
- 408 answers from three experiments: the description A/B (both arms, 4 models) and the 10-run guardrail repeat (6 models). 80 to 84 answers per story.
- One reviewer per story, working from a shuffled packet with the arm labels and the grader's verdicts removed. Each answer was judged against a written rubric: pass, fail, or borderline.
- The reviewers also recorded whether the answer told the user to set up the search key.
- Raw runs and packets are kept outside the repo.

Hand-judged passes (borderline answers are not counted as passes)

| Story | Current description | New description | Guardrail repeat (v2.0.0, 6 models) |
|---|---|---|---|
| S5 site queries | 13/40 | 39/40 | |
| S10 HTML page | 31/40 | 31/40 | |
| S6 no company named | 10/12 | 9/12 | 42/60 (8 borderline) |
| S7 unreadable company | 10/12 | 10/12 | 46/60 |
| S9 nonexistent company | 12/12 | 11/12 | 49/60 (1 borderline) |

What it showed about the grader
- The grader never passed an answer the reviewers would fail.
- It failed 23 answers the reviewers passed: 18 on S7, 2 on S9, 3 on S6. Most were advice such as "to find Amazon's job openings, you can visit amazon.jobs", or a refusal such as "that doesn't show the company isn't hiring". The fix (`grade.mjs`) exempts instructions, reasons the skill cannot read a company, and negated refusals, while keeping real claims failing. The 23 answers are regression fixtures in `evals/fixtures/reviewed-correct.jsonl`.
- 8 of those 23 still fail, correctly, because they tell the user to set the search key after a `--check`.
- On the 332 answers for S5, S6, S7 and S9 the grader's "recommends the search key" flag and the reviewers' judgment agree on every answer (66 both flag it, 266 neither).

Reading the other tables in this directory
- The summaries here were all regraded with the final grader from the saved raw runs, so they can be compared with each other. Earlier grader versions gave different S7 and S9 numbers.
- "Pass" for S7 and S9 now also requires not recommending the search key, which the old answers often did.
- Three runs per cell is a small sample; the S6 and S9 differences above are one run each.
