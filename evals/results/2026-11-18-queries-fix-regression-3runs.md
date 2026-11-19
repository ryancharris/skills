# Agent eval: queries-fix-regression-3runs (2026-11-18)

- Skill: `fix/queries-name-the-company` at `92c4d29`
- Agent versions: opencode 1.19.6, node 22.23.5
- 60 valid runs, 4 models, stories S1, S3, S6, S7, S9, shuffle seed 12
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S1 | S3 | S6 | S7 | S9 | Total |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 15/15 |
| deepseek/deepseek-v4.1-flash-1017 | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 14/15 |
| qwen/qwen3-coder | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 | 14/15 |
| ~deepseek/deepseek-v4-flash-latest | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 14/15 |

## Stories

- **S1**: Roles at one named company
- **S3**: Hiring check after a layoff
- **S6**: No companies named
- **S7**: Unsupported company (no verdict from memory)
- **S9**: Company that does not exist

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 15/15 | 0 | 0 | 10 | 635k | $0.36 |
| deepseek/deepseek-v4.1-flash-1017 | 15/15 | 0 | 0 | 7 | 435k | $0.02 |
| qwen/qwen3-coder | 15/15 | 0 | 0 | 8 | 428k | $0.05 |
| ~deepseek/deepseek-v4-flash-latest | 15/15 | 0 | 0 | 9 | 442k | $0.02 |

## Failed checks

- S6: did not ask a question (1)
- S7: CLI never run for Amazon (2)
- S7: CLI output does not say no job board found (2)
- S7: answer lacks the quoted cannot-check sentence (1)
