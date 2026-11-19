# Agent eval: description-variant-routing-10runs (2026-11-19)

- Skill: `fix/description-routing` at `1a1e3f8`
- Agent versions: opencode 1.19.6, node 22.23.5
- 2 run(s) hit the time limit and were killed (graded by the grader, see timed-out runs in the report).
- 80 valid runs, 4 models, stories S5, S10, shuffle seed 11
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S5 | S10 | Total |
|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 10/10 | 10/10 | 20/20 |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 10/10 | 20/20 |
| qwen/qwen3-coder | 10/10 | 2/10 | 12/20 |
| ~deepseek/deepseek-v4-flash-latest | 10/10 | 10/10 | 20/20 |

## Stories

- **S5**: Search queries, no API key
- **S10**: HTML output

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 20/20 | 0 | 0 | 14 | 1210k | $0.70 |
| deepseek/deepseek-v4.1-flash-1017 | 20/20 | 0 | 0 | 16 | 1670k | $0.06 |
| qwen/qwen3-coder | 12/20 | 10 | 0 | 107 | 1172k | $0.23 |
| ~deepseek/deepseek-v4-flash-latest | 20/20 | 0 | 0 | 11 | 807k | $0.03 |

## Failed checks

- S10: did not use --format html (6)
- S10: timed out (2)
