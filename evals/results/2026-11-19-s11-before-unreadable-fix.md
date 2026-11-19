# Agent eval: s11-before-unreadable-fix (2026-11-19)

- Skill: `c5f8f40` at `c5f8f40`
- Agent versions: opencode 1.19.6, node 22.23.5
- 50 valid runs, 5 models, stories S11, shuffle seed 21
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S11 | Total |
|---|---|---|
| anthropic/claude-sonnet-5.5 | 10/10 | 10/10 |
| deepseek/deepseek-v4.1-flash-1017 | 9/10 | 9/10 |
| moonshotai/kimi-k3 | 9/10 | 9/10 |
| qwen/qwen3-coder | 10/10 | 10/10 |
| ~deepseek/deepseek-v4-flash-latest | 10/10 | 10/10 |

## Stories

- **S11**: Roles at a readable and an unreadable company

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 10/10 | 0 | 0 | 19 | 532k | $0.52 |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 0 | 0 | 17 | 507k | $0.03 |
| moonshotai/kimi-k3 | 10/10 | 0 | 0 | 23 | 467k | $0.41 |
| qwen/qwen3-coder | 10/10 | 0 | 0 | 8 | 486k | $0.06 |
| ~deepseek/deepseek-v4-flash-latest | 10/10 | 0 | 0 | 12 | 483k | $0.01 |

## Failed checks

- S11: URL not in tool output (2)
