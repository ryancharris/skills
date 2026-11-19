# Agent eval: queries-fix-routing-10runs (2026-11-18)

- Skill: `fix/queries-name-the-company` at `92c4d29`
- 80 valid runs, 4 models, stories S5, S10, shuffle seed 11
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S5 | S10 | Total |
|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 8/10 | 10/10 | 18/20 |
| deepseek/deepseek-v4.1-flash-1017 | 5/10 | 9/10 | 14/20 |
| qwen/qwen3-coder | 0/10 | 5/10 | 5/20 |
| ~deepseek/deepseek-v4-flash-latest | 1/10 | 10/10 | 11/20 |

## Stories

- **S5**: Search queries, no API key
- **S10**: HTML output

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 18/20 | 0 | 2 | 14 | 1135k | $0.61 |
| deepseek/deepseek-v4.1-flash-1017 | 15/20 | 0 | 5 | 11 | 1124k | $0.04 |
| qwen/qwen3-coder | 5/20 | 18 | 1 | 26 | 1269k | $0.20 |
| ~deepseek/deepseek-v4-flash-latest | 11/20 | 1 | 8 | 13 | 630k | $0.03 |

## Failed checks

- S10: did not use --format html (6)
- S5: did not use --queries (10)
- S5: malformed tool call, never ran (16)
