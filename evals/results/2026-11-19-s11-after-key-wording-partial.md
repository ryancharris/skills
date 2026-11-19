# Agent eval: s11-after-key-wording (2026-11-19)

- Skill: `docs/search-key-optional` at `4945889`
- Agent versions: opencode 1.19.6, node 22.23.5
- **WARNING: 2 of 50 runs hit an API error and are excluded from every rate below.** Do not compare this run until it is repeated. First error: This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 10141. To increase, visit https://openrouter.ai/w
- 48 valid runs, 5 models, stories S11, shuffle seed 24
- Each run is a fresh opencode session in Docker. Grading is strict and keyword-based (`evals/grade.mjs`); S7 and S9 match wording, so a pass there is weaker evidence.

## Passes by model and story

| Model | S11 | Total |
|---|---|---|
| anthropic/claude-sonnet-5.5 | 9/9 (+1 err) | 9/9 (+1 err) |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 10/10 |
| moonshotai/kimi-k3 | 9/9 (+1 err) | 9/9 (+1 err) |
| qwen/qwen3-coder | 10/10 | 10/10 |
| ~deepseek/deepseek-v4-flash-latest | 10/10 | 10/10 |

## Stories

- **S11**: Roles at a readable and an unreadable company

## Per model

| Model | Loaded the skill | Runs using web tools | Malformed tool calls | Avg seconds | Tokens | Cost |
|---|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 9/9 | 0 | 0 | 22 | 490k | $0.45 |
| deepseek/deepseek-v4.1-flash-1017 | 10/10 | 0 | 0 | 18 | 502k | $0.03 |
| moonshotai/kimi-k3 | 9/9 | 0 | 0 | 27 | 435k | $0.44 |
| qwen/qwen3-coder | 10/10 | 0 | 0 | 10 | 509k | $0.06 |
| ~deepseek/deepseek-v4-flash-latest | 10/10 | 0 | 0 | 14 | 476k | $0.01 |

## Failed checks

None.
